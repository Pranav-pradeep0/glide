import { create } from 'zustand';
import { AppState, DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import { AudioRepeatMode, AudioTrack } from '@/types';
import { AudioMediaService } from '@/services/AudioMediaService';
import { PermissionService } from '@/services/PermissionService';
import { EQUALIZER_PRESETS } from '@/config/equalizerPresets';
import { useMusicHistoryStore } from '@/store/musicHistoryStore';

const getAudioModule = () => NativeModules.GlideAudioPlayerModule;
const mmkv = createMMKV({ id: 'glide_audio_store_v1' });

/** Pre-2.3 key: the whole queue as track JSON. Read once to migrate, then removed. */
const LEGACY_QUEUE_KEY = '@glide_audio_queue';
const QUEUE_IDS_KEY = '@glide_audio_queue_ids';
const HYDRATION_TIMEOUT_MS = 5000;
const PLAYBACK_KEY = '@glide_audio_playback_state';
const CURRENT_TRACK_KEY = '@glide_audio_current_track';

interface StoredPlaybackState {
    currentIndex: number;
    position: number;
    duration: number;
    shuffle: boolean;
    repeatMode: AudioRepeatMode;
    equalizerPreset: string;
    queueSource?: string;
    currentTrack?: AudioTrack | null;
}

let initialPlayback: StoredPlaybackState = {
    currentIndex: 0,
    position: 0,
    duration: 0,
    shuffle: false,
    repeatMode: 'off',
    equalizerPreset: 'flat',
    queueSource: 'Library',
};
let initialTrack: AudioTrack | null = null;

try {
    const rawPlayback = mmkv.getString(PLAYBACK_KEY);
    if (rawPlayback) {
        initialPlayback = { ...initialPlayback, ...JSON.parse(rawPlayback) };
    }
    const rawTrack = mmkv.getString(CURRENT_TRACK_KEY);
    if (rawTrack) {
        initialTrack = JSON.parse(rawTrack);
    } else if (initialPlayback.currentTrack) {
        initialTrack = initialPlayback.currentTrack;
    }
} catch {
    // ignore
}

/** The saved queue, as ids. Migrates the old full-JSON key on first run after the change. */
function readPersistedIds(): string[] {
    try {
        const rawIds = mmkv.getString(QUEUE_IDS_KEY);
        if (rawIds) {
            const ids = JSON.parse(rawIds);
            return Array.isArray(ids) ? ids.map(String) : [];
        }
        const legacy = mmkv.getString(LEGACY_QUEUE_KEY);
        if (legacy) {
            const queue = JSON.parse(legacy) as AudioTrack[];
            const ids = Array.isArray(queue) ? queue.map((t) => String(t.id)) : [];
            // Converted in place, before anything can return early: the old key is only
            // removed once its ids are safely under the new one.
            mmkv.set(QUEUE_IDS_KEY, JSON.stringify(ids));
            mmkv.remove(LEGACY_QUEUE_KEY);
            return ids;
        }
    } catch {
        // ignore
    }
    return [];
}

/**
 * Rebuild the queue from the saved ids, off the module-evaluation path.
 *
 * Only ids are stored: a 5,000-song queue was ~2 MB of track JSON, stringified on the JS
 * thread every time a song was tapped. MediaStore holds the records, and the playing track
 * is saved whole, so the mini player is right before this finishes.
 *
 * Without the audio permission there is no library to resolve against, and asking for it
 * at launch is not this function's business, so only the saved current track is restored.
 */
async function hydratePersistedQueue() {
    try {
        const ids = readPersistedIds();
        if (useAudioStore.getState().queue.length > 0) { return; }

        let queue: AudioTrack[] = [];
        if (ids.length > 0 && await PermissionService.checkAudioPermission()) {
            const byId = new Map((await AudioMediaService.getSongs()).map((s) => [String(s.id), s]));
            queue = ids.map((id) => byId.get(id)).filter((t): t is AudioTrack => !!t);
        }

        const current = useAudioStore.getState();
        // Something started playing while the library was being read; leave it alone.
        if (current.queue.length > 0) { return; }

        const track = current.currentTrack;
        const byTrack = track ? queue.findIndex((t) => String(t.id) === String(track.id)) : -1;
        let safeIndex = byTrack >= 0
            ? byTrack
            : Math.max(0, Math.min(current.currentIndex, queue.length));
        // The mini player shows the saved current track whatever happens here, so it has to
        // be in the queue for play to play it. It is missing when the library cannot resolve
        // it -- a file opened from Files is saved under its content:// URL, not a MediaStore
        // id -- or when it was deleted since.
        if (track && byTrack < 0) {
            queue = [...queue.slice(0, safeIndex), track, ...queue.slice(safeIndex)];
        } else if (queue.length > 0) {
            safeIndex = Math.min(safeIndex, queue.length - 1);
        }
        if (queue.length === 0) { return; }

        useAudioStore.setState({
            queue,
            currentIndex: safeIndex,
            currentTrack: track || queue[safeIndex] || null,
        });
    } catch {
        // ignore
    }
}
/**
 * Settles once the saved queue is back. Queue actions wait on it: before it settles the
 * queue is empty while the mini player already shows the saved track, so play would start
 * an empty player and "play next" would replace the queue it was about to get back.
 */
const queueHydrated = new Promise<void>((resolve) => {
    setTimeout(() => { hydratePersistedQueue().then(resolve); }, 0);
    // A ceiling, so a native call that never settles cannot leave play dead for good.
    const ceiling = setTimeout(resolve, HYDRATION_TIMEOUT_MS);
    (ceiling as any)?.unref?.();
});

const safeInitialIndex = initialPlayback.currentIndex || 0;

/**
 * Where native's playing track sits in our queue: by id, with native's index as the tiebreak.
 * -1 when the playing track is not in our queue at all -- a queue started from Android Auto
 * or another controller. Showing whatever song sits at native's index would be a wrong song.
 */
export function resolveQueueIndex(queue: AudioTrack[], nativeIndex: number, trackId?: string): number {
    if (!trackId) { return nativeIndex; }
    // If nativeIndex already points to this trackId, honor native's current index (breaks duplicates tie)
    if (queue[nativeIndex] && String(queue[nativeIndex].id) === String(trackId)) {
        return nativeIndex;
    }
    return queue.findIndex(t => String(t.id) === String(trackId));
}

/**
 * Debounced writes, keyed by what they write, so a background transition can run whatever
 * is still waiting: Android may kill the process right after, and a 1 s debounce would
 * otherwise lose the last queue edit or position.
 */
const pendingWrites = new Map<string, { timer: ReturnType<typeof setTimeout>; write: () => void }>();

function debounceWrite(key: string, delayMs: number, write: () => void) {
    const pending = pendingWrites.get(key);
    if (pending) { clearTimeout(pending.timer); }
    const run = () => {
        pendingWrites.delete(key);
        try {
            write();
        } catch {
            // ignore
        }
    };
    const timer = setTimeout(run, delayMs);
    (timer as any)?.unref?.();
    pendingWrites.set(key, { timer, write: run });
}

export function flushPendingWrites() {
    for (const { timer, write } of Array.from(pendingWrites.values())) {
        clearTimeout(timer);
        write();
    }
}

function persistQueue(queue: AudioTrack[], immediate = false) {
    const write = () => mmkv.set(QUEUE_IDS_KEY, JSON.stringify(queue.map((t) => String(t.id))));
    if (immediate || queue.length === 0 || process.env.NODE_ENV === 'test') {
        const pending = pendingWrites.get(QUEUE_IDS_KEY);
        if (pending) {
            clearTimeout(pending.timer);
            pendingWrites.delete(QUEUE_IDS_KEY);
        }
        try {
            write();
        } catch {
            // ignore
        }
        return;
    }
    debounceWrite(QUEUE_IDS_KEY, 1000, write);
}

function persistCurrentTrack(track: AudioTrack | null) {
    try {
        if (track) {
            mmkv.set(CURRENT_TRACK_KEY, JSON.stringify(track));
        } else {
            mmkv.remove(CURRENT_TRACK_KEY);
        }
    } catch {
        // ignore
    }
}

function schedulePersistPlayback(state: StoredPlaybackState) {
    debounceWrite(PLAYBACK_KEY, 500, () => mmkv.set(PLAYBACK_KEY, JSON.stringify(state)));
}

/** How often a playing song's position is saved, so a killed app resumes close to it. */
const POSITION_SAVE_INTERVAL_MS = 5000;
let lastPositionSaveAt = 0;

function getPresetBands(presetId: string): number[] | null {
    const preset = EQUALIZER_PRESETS.find((p) => p.id === presetId);
    return preset?.values ?? null;
}

let sleepTimerInterval: any = null;
function clearSleepTimerInterval() {
    if (sleepTimerInterval) {
        clearInterval(sleepTimerInterval);
        sleepTimerInterval = null;
    }
}

export interface AudioStoreState {
    currentTrack: AudioTrack | null;
    queue: AudioTrack[];
    currentIndex: number;
    isPlaying: boolean;
    isBuffering: boolean;
    position: number;
    duration: number;
    shuffle: boolean;
    repeatMode: AudioRepeatMode;
    equalizerPreset: string;
    shuffledIndices: number[];
    queueSource?: string;
    sleepTimerMode: 'off' | 'time' | 'end_of_track';
    sleepTimerRemaining: number;

    // Actions
    playTrack: (track: AudioTrack, newQueue?: AudioTrack[], queueSource?: string) => Promise<void>;
    playQueue: (queue: AudioTrack[], startIndex?: number, queueSource?: string) => Promise<void>;
    playNext: (track: AudioTrack) => Promise<void>;
    addToQueue: (track: AudioTrack) => Promise<void>;
    removeFromQueue: (index: number) => Promise<void>;
    moveQueueItem: (fromIndex: number, toIndex: number) => Promise<void>;
    setSleepTimer: (option: number | 'end_of_track' | 'off') => void;
    togglePlayPause: () => Promise<void>;
    play: () => Promise<void>;
    pause: () => Promise<void>;
    seekTo: (seconds: number) => Promise<void>;
    skipNext: () => Promise<void>;
    skipPrevious: () => Promise<void>;
    skipToIndex: (index: number) => Promise<void>;
    toggleShuffle: () => Promise<void>;
    toggleRepeatMode: () => Promise<void>;
    setAudioEqualizer: (bands: number[]) => Promise<void>;
    setEqualizerPreset: (presetId: string) => Promise<void>;
    clearQueue: () => Promise<void>;
    hydrateQueue: () => Promise<void>;

    // Internal updates from native events
    _setPlaybackState: (state: { isPlaying: boolean; isBuffering: boolean; position?: number; duration?: number }) => void;
    _setTrackChanged: (data: { currentIndex: number; trackId?: string; duration?: number; queueIndices?: number[] }) => void;
    _setProgress: (data: { position: number; duration: number }) => void;
    _persistState: () => void;
}

export const useAudioStore = create<AudioStoreState>((set, get) => ({
    currentTrack: initialTrack,
    // Filled by hydratePersistedQueue once MediaStore has answered.
    queue: [],
    currentIndex: safeInitialIndex,
    isPlaying: false,
    isBuffering: false,
    position: initialPlayback.position,
    duration: initialPlayback.duration,
    shuffle: initialPlayback.shuffle,
    repeatMode: initialPlayback.repeatMode,
    equalizerPreset: initialPlayback.equalizerPreset,
    shuffledIndices: [],
    queueSource: initialPlayback.queueSource || 'Library',
    sleepTimerMode: 'off',
    sleepTimerRemaining: 0,

    playTrack: async (track: AudioTrack, newQueue?: AudioTrack[], queueSource?: string) => {
        const queue = newQueue && newQueue.length > 0 ? newQueue : [track];
        const index = queue.findIndex((t) => t.id === track.id);
        const startIndex = index >= 0 ? index : 0;
        const { shuffle, repeatMode, equalizerPreset } = get();
        const equalizerBands = getPresetBands(equalizerPreset);
        const source = queueSource ?? get().queueSource ?? 'Library';

        set({
            currentTrack: track,
            queue,
            currentIndex: startIndex,
            isPlaying: true,
            isBuffering: true,
            position: 0,
            duration: track.duration,
            queueSource: source,
        });

        // Save queue only when queue changes
        persistCurrentTrack(track);
        persistQueue(queue);

        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                if (typeof audioModule.setQueueByIds === 'function' && queue.length > 50) {
                    const trackIds = queue.map((t) => t.id);
                    await audioModule.setQueueByIds(trackIds, startIndex, 0, true, shuffle, repeatMode, equalizerBands);
                } else {
                    await audioModule.setQueue(queue, startIndex, 0, true, shuffle, repeatMode, equalizerBands);
                }
            } catch (err) {
                console.error('[AudioStore] playTrack error:', err);
                set({ isPlaying: false, isBuffering: false });
            }
        }

        get()._persistState();

        if (!track.artworkUri && track.albumId) {
            AudioMediaService.getAlbumArt(track.albumId, track.uri).then((art) => {
                if (art && get().currentTrack?.id === track.id) {
                    set((prev) => ({
                        currentTrack: prev.currentTrack ? { ...prev.currentTrack, artworkUri: art } : null,
                    }));
                }
            });
        }
    },

    playQueue: async (queue: AudioTrack[], startIndex = 0, queueSource?: string) => {
        if (!queue || queue.length === 0) {return;}
        const safeIndex = Math.max(0, Math.min(startIndex, queue.length - 1));
        const track = queue[safeIndex];
        const { shuffle, repeatMode, equalizerPreset } = get();
        const equalizerBands = getPresetBands(equalizerPreset);
        const source = queueSource ?? get().queueSource ?? 'Library';

        set({
            currentTrack: track,
            queue,
            currentIndex: safeIndex,
            isPlaying: true,
            isBuffering: true,
            position: 0,
            duration: track.duration,
            queueSource: source,
        });

        persistCurrentTrack(track);
        persistQueue(queue);

        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                if (typeof audioModule.setQueueByIds === 'function' && queue.length > 50) {
                    const trackIds = queue.map((t) => t.id);
                    await audioModule.setQueueByIds(trackIds, safeIndex, 0, true, shuffle, repeatMode, equalizerBands);
                } else {
                    await audioModule.setQueue(queue, safeIndex, 0, true, shuffle, repeatMode, equalizerBands);
                }
            } catch (err) {
                console.error('[AudioStore] playQueue error:', err);
                set({ isPlaying: false, isBuffering: false });
            }
        }

        get()._persistState();

        if (!track.artworkUri && track.albumId) {
            AudioMediaService.getAlbumArt(track.albumId, track.uri).then((art) => {
                if (art && get().currentTrack?.id === track.id) {
                    set((prev) => ({
                        currentTrack: prev.currentTrack ? { ...prev.currentTrack, artworkUri: art } : null,
                    }));
                }
            });
        }
    },

    playNext: async (track: AudioTrack) => {
        await queueHydrated;
        const { queue, currentIndex } = get();
        if (queue.length === 0) {
            await get().playTrack(track);
            return;
        }
        const insertIndex = currentIndex + 1;
        const nextQueue = [...queue];
        nextQueue.splice(insertIndex, 0, track);
        set({ queue: nextQueue });
        persistQueue(nextQueue);

        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.addMediaItem(insertIndex, track);
            } catch (err) {
                console.error('[AudioStore] playNext error:', err);
            }
        }
    },

    addToQueue: async (track: AudioTrack) => {
        await queueHydrated;
        const { queue } = get();
        if (queue.length === 0) {
            await get().playTrack(track);
            return;
        }
        const insertIndex = queue.length;
        const nextQueue = [...queue, track];
        set({ queue: nextQueue });
        persistQueue(nextQueue);

        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.addMediaItem(insertIndex, track);
            } catch (err) {
                console.error('[AudioStore] addToQueue error:', err);
            }
        }
    },

    removeFromQueue: async (index: number) => {
        const { queue, currentIndex, position } = get();
        if (index < 0 || index >= queue.length) return;
        if (queue.length === 1) {
            await get().clearQueue();
            return;
        }

        const nextQueue = queue.filter((_, i) => i !== index);
        let nextIndex = currentIndex;
        let nextTrack = get().currentTrack;
        let nextPosition = position;

        if (index === currentIndex) {
            nextIndex = Math.min(currentIndex, nextQueue.length - 1);
            nextTrack = nextQueue[nextIndex];
            nextPosition = 0;
            persistCurrentTrack(nextTrack);
        } else if (index < currentIndex) {
            nextIndex = currentIndex - 1;
        }

        set({
            queue: nextQueue,
            currentIndex: nextIndex,
            currentTrack: nextTrack,
            position: nextPosition,
        });
        persistQueue(nextQueue);

        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.removeMediaItem(index);
            } catch (err) {
                console.error('[AudioStore] removeFromQueue error:', err);
            }
        }
        get()._persistState();
    },

    moveQueueItem: async (fromIndex: number, toIndex: number) => {
        const { queue, currentIndex } = get();
        if (
            fromIndex < 0 ||
            fromIndex >= queue.length ||
            toIndex < 0 ||
            toIndex >= queue.length ||
            fromIndex === toIndex
        ) {
            return;
        }

        const nextQueue = [...queue];
        const [movedItem] = nextQueue.splice(fromIndex, 1);
        nextQueue.splice(toIndex, 0, movedItem);

        let nextIndex = currentIndex;
        if (currentIndex === fromIndex) {
            nextIndex = toIndex;
        } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
            nextIndex = currentIndex - 1;
        } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
            nextIndex = currentIndex + 1;
        }

        set({
            queue: nextQueue,
            currentIndex: nextIndex,
        });
        persistQueue(nextQueue);

        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.moveMediaItem(fromIndex, toIndex);
            } catch (err) {
                console.error('[AudioStore] moveQueueItem error:', err);
            }
        }
        get()._persistState();
    },

    setSleepTimer: async (option: number | 'end_of_track' | 'off') => {
        clearSleepTimerInterval();
        const audioModule = getAudioModule();
        if (option === 'off') {
            set({ sleepTimerMode: 'off', sleepTimerRemaining: 0 });
            if (Platform.OS === 'android' && audioModule) {
                try {
                    await audioModule.clearSleepTimer();
                } catch (err) {
                    console.error('[AudioStore] clearSleepTimer error:', err);
                }
            }
            return;
        }
        if (option === 'end_of_track') {
            set({ sleepTimerMode: 'end_of_track', sleepTimerRemaining: 0 });
            if (Platform.OS === 'android' && audioModule) {
                try {
                    await audioModule.setSleepTimer(0, true);
                } catch (err) {
                    console.error('[AudioStore] setSleepTimer error:', err);
                }
            }
            return;
        }
        const totalSecs = option * 60;
        const endTime = Date.now() + totalSecs * 1000;
        set({ sleepTimerMode: 'time', sleepTimerRemaining: totalSecs });
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.setSleepTimer(option, false);
            } catch (err) {
                console.error('[AudioStore] setSleepTimer error:', err);
            }
        }
        sleepTimerInterval = setInterval(() => {
            const remaining = Math.max(0, Math.round((endTime - Date.now()) / 1000));
            if (remaining <= 0) {
                clearSleepTimerInterval();
                set({ sleepTimerMode: 'off', sleepTimerRemaining: 0 });
            } else {
                set({ sleepTimerRemaining: remaining });
            }
        }, 1000);
    },

    togglePlayPause: async () => {
        await queueHydrated;
        const { isPlaying, currentTrack, queue, currentIndex, position, shuffle, repeatMode, equalizerPreset } = get();
        if (!currentTrack) {
            if (queue.length > 0) {
                await get().playQueue(queue, currentIndex);
            }
            return;
        }

        if (isPlaying) {
            await get().pause();
        } else {
            const audioModule = getAudioModule();
            if (Platform.OS === 'android' && audioModule) {
                try {
                    const state = await audioModule.getCurrentState();
                    if (!state.trackId && queue.length > 0) {
                        const equalizerBands = getPresetBands(equalizerPreset);
                        if (typeof audioModule.setQueueByIds === 'function' && queue.length > 50) {
                            const trackIds = queue.map((t) => t.id);
                            await audioModule.setQueueByIds(trackIds, currentIndex, position, true, shuffle, repeatMode, equalizerBands);
                        } else {
                            await audioModule.setQueue(queue, currentIndex, position, true, shuffle, repeatMode, equalizerBands);
                        }
                        set({ isPlaying: true });
                        return;
                    }
                } catch {
                    // Fall through
                }
            }
            await get().play();
        }
    },

    play: async () => {
        set({ isPlaying: true });
        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.play();
            } catch (err) {
                console.error('[AudioStore] play error:', err);
                set({ isPlaying: false });
            }
        }
    },

    pause: async () => {
        set({ isPlaying: false });
        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.pause();
            } catch (err) {
                console.error('[AudioStore] pause error:', err);
            }
        }
        get()._persistState();
    },

    seekTo: async (seconds: number) => {
        set({ position: seconds });
        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.seekTo(seconds);
            } catch (err) {
                console.error('[AudioStore] seekTo error:', err);
            }
        }
        get()._persistState();
    },

    skipNext: async () => {
        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.skipToNext();
            } catch (err) {
                console.error('[AudioStore] skipNext error:', err);
            }
        }
    },

    skipPrevious: async () => {
        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.skipToPrevious();
            } catch (err) {
                console.error('[AudioStore] skipPrevious error:', err);
            }
        }
    },

    skipToIndex: async (index: number) => {
        const { queue } = get();
        if (index < 0 || index >= queue.length) {return;}
        const track = queue[index];

        set({
            currentIndex: index,
            currentTrack: track,
            position: 0,
            duration: track.duration,
            isPlaying: true,
        });
        persistCurrentTrack(track);

        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.skipToIndex(index);
            } catch (err) {
                console.error('[AudioStore] skipToIndex error:', err);
            }
        }

        get()._persistState();
    },

    toggleShuffle: async () => {
        const next = !get().shuffle;
        set({ shuffle: next });
        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.setShuffleMode(next);
            } catch (err) {
                console.error('[AudioStore] toggleShuffle error:', err);
            }
        }
        get()._persistState();
    },

    toggleRepeatMode: async () => {
        const current = get().repeatMode;
        const modes: AudioRepeatMode[] = ['off', 'all', 'one'];
        const nextIndex = (modes.indexOf(current) + 1) % modes.length;
        const next = modes[nextIndex];
        set({ repeatMode: next });

        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.setRepeatMode(next);
            } catch (err) {
                console.error('[AudioStore] toggleRepeatMode error:', err);
            }
        }
        get()._persistState();
    },

    setAudioEqualizer: async (bands: number[]) => {
        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.setAudioEqualizer(bands);
            } catch (err) {
                console.error('[AudioStore] setAudioEqualizer error:', err);
            }
        }
    },

    setEqualizerPreset: async (presetId: string) => {
        set({ equalizerPreset: presetId });
        const bands = getPresetBands(presetId);
        if (bands) {
            await get().setAudioEqualizer(bands);
        }
        get()._persistState();
    },

    clearQueue: async () => {
        set({
            currentTrack: null,
            queue: [],
            currentIndex: 0,
            isPlaying: false,
            position: 0,
            duration: 0,
            shuffledIndices: [],
        });
        persistCurrentTrack(null);
        persistQueue([], true);
        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.stop();
            } catch {
                // ignore
            }
        }
        get()._persistState();
    },

    hydrateQueue: () => hydratePersistedQueue(),

    _setPlaybackState: (state) => {
        set((prev) => ({
            isPlaying: state.isPlaying,
            isBuffering: state.isBuffering,
            position: state.position !== undefined ? state.position : prev.position,
            duration: state.duration !== undefined && state.duration > 0 ? state.duration : prev.duration,
        }));
    },

    _setTrackChanged: (data) => {
        const { queue, currentTrack } = get();
        // Native's index is only a hint: after a failed queue call or an error auto-skip the
        // two queues can disagree, and indexing would show the wrong song. The id is what is
        // actually playing; the index only breaks ties when a song is queued twice.
        const nextIndex = resolveQueueIndex(queue, data.currentIndex, data.trackId);
        let nextTrack: AudioTrack | null = null;
        if (nextIndex >= 0 && nextIndex < queue.length) {
            nextTrack = queue[nextIndex];
        } else if (data.trackId) {
            const found = queue.find(t => String(t.id) === String(data.trackId));
            if (found) {
                nextTrack = found;
            } else {
                const cached = AudioMediaService.getCachedSongById(data.trackId);
                if (cached) {
                    nextTrack = cached;
                }
            }
        }

        if (nextTrack) {
            const hasTrackChanged = nextTrack.id !== currentTrack?.id;

            set((prev) => ({
                currentIndex: nextIndex >= 0 && nextIndex < queue.length ? nextIndex : prev.currentIndex,
                currentTrack: nextTrack,
                // Only reset position to 0 when the playing song actually changes, not when its index shifts from queue edits
                position: hasTrackChanged ? 0 : prev.position,
                duration: data.duration && data.duration > 0 ? data.duration : nextTrack.duration,
                shuffledIndices: data.queueIndices ?? prev.shuffledIndices,
            }));
            persistCurrentTrack(nextTrack);
            get()._persistState();

            if (!nextTrack.artworkUri && nextTrack.albumId) {
                AudioMediaService.getAlbumArt(nextTrack.albumId, nextTrack.uri).then((art) => {
                    if (art && get().currentTrack?.id === nextTrack.id) {
                        set((prev) => ({
                            currentTrack: prev.currentTrack ? { ...prev.currentTrack, artworkUri: art } : null,
                        }));
                    }
                });
            }
        }
    },

    _setProgress: (data) => {
        set((prev) => ({
            position: data.position,
            duration: data.duration > 0 ? data.duration : prev.duration,
        }));
        const now = Date.now();
        if (now - lastPositionSaveAt >= POSITION_SAVE_INTERVAL_MS) {
            lastPositionSaveAt = now;
            get()._persistState();
        }
    },

    _persistState: () => {
        const { currentIndex, position, duration, shuffle, repeatMode, equalizerPreset, queueSource, currentTrack } = get();
        // Persist only lightweight playback state (~100 bytes) on regular state transitions
        schedulePersistPlayback({
            currentIndex,
            position,
            duration,
            shuffle,
            repeatMode,
            equalizerPreset,
            queueSource,
            currentTrack,
        });
    },
}));

// Setup native device event listeners
if (Platform.OS === 'android') {
    AppState.addEventListener('change', (next) => {
        if (next === 'background' || next === 'inactive') {
            useAudioStore.getState()._persistState();
            flushPendingWrites();
        }
    });

    DeviceEventEmitter.addListener('onAudioPlaybackStateChanged', (event) => {
        useAudioStore.getState()._setPlaybackState({
            isPlaying: !!event.isPlaying,
            isBuffering: !!event.isBuffering,
            position: typeof event.position === 'number' ? event.position : undefined,
            duration: typeof event.duration === 'number' ? event.duration : undefined,
        });
    });

    DeviceEventEmitter.addListener('onAudioTrackChanged', (event) => {
        useAudioStore.getState()._setTrackChanged({
            currentIndex: event.currentIndex ?? 0,
            trackId: event.trackId,
            duration: event.duration,
            queueIndices: Array.isArray(event.queueIndices) ? event.queueIndices : undefined,
        });
    });

    DeviceEventEmitter.addListener('onAudioProgress', (event) => {
        useAudioStore.getState()._setProgress({
            position: event.position ?? 0,
            duration: event.duration ?? 0,
        });
    });

    DeviceEventEmitter.addListener('onAudioError', () => {
        useAudioStore.getState()._setPlaybackState({ isPlaying: false, isBuffering: false });
    });

    DeviceEventEmitter.addListener('onSleepTimerFired', () => {
        clearSleepTimerInterval();
        useAudioStore.setState({ sleepTimerMode: 'off', sleepTimerRemaining: 0 });
    });

    if (NativeModules.GlideAudioPlayerModule?.getCurrentState) {
        NativeModules.GlideAudioPlayerModule.getCurrentState().then((state: any) => {
            if (state && (state.isPlaying || state.position > 0)) {
                useAudioStore.getState()._setPlaybackState({
                    isPlaying: !!state.isPlaying,
                    isBuffering: !!state.isBuffering,
                    position: typeof state.position === 'number' ? state.position : undefined,
                    duration: typeof state.duration === 'number' ? state.duration : undefined,
                });
                if (state.trackId) {
                    useAudioStore.getState()._setTrackChanged({
                        currentIndex: state.currentIndex ?? 0,
                        trackId: state.trackId,
                        duration: state.duration,
                        queueIndices: Array.isArray(state.queueIndices) ? state.queueIndices : undefined,
                    });
                }
            }
        }).catch(() => {});
    }
}

// Recents > Music. One place catches every way a song starts: a tap, skip, auto-advance or
// the notification controls. The song restored at launch is not a change, so it is not counted.
useAudioStore.subscribe((state, prev) => {
    const id = state.currentTrack?.id;
    if (id && id !== prev.currentTrack?.id) {
        useMusicHistoryStore.getState().recordPlay(id);
    }
});
