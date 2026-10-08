import { beforeEach, afterEach, afterAll, describe, expect, it, jest } from '@jest/globals';

const mockMMKVStore = new Map<string, string>();

jest.mock('react-native-mmkv', () => ({
    createMMKV: () => ({
        set: (k: string, v: string) => mockMMKVStore.set(k, v),
        getString: (k: string) => mockMMKVStore.get(k),
        delete: (k: string) => mockMMKVStore.delete(k),
        clearAll: () => mockMMKVStore.clear(),
    }),
}));

import { NativeModules, Platform } from 'react-native';

Object.defineProperty(Platform, 'OS', {
    get: () => 'android',
    configurable: true,
});

NativeModules.GlideAudioPlayerModule = {
    setQueue: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    setQueueByIds: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    addMediaItem: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    removeMediaItem: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    moveMediaItem: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    setSleepTimer: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    clearSleepTimer: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    play: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    pause: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    stop: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    seekTo: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    skipToNext: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    skipToPrevious: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    skipToIndex: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    setRepeatMode: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    setShuffleMode: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    setAudioEqualizer: jest.fn<any>().mockReturnValue(Promise.resolve(true)),
    getCurrentState: jest.fn<any>().mockReturnValue(Promise.resolve({ trackId: '101' })),
};

NativeModules.MediaStoreAudioModule = {
    getSongs: jest.fn<any>().mockReturnValue(Promise.resolve([])),
    getAlbumArt: jest.fn<any>().mockReturnValue(Promise.resolve('file:///cache/album_art/201.jpg')),
    getAlbumArtWithPalette: jest.fn<any>().mockReturnValue(Promise.resolve({
        artworkUri: 'file:///cache/album_art/201.jpg',
        primaryColor: '#123456',
        secondaryColor: '#654321',
        onPrimaryColor: '#ffffff',
    })),
};

jest.mock('@react-native-documents/picker', () => ({
    pick: jest.fn(async () => []),
}));

jest.mock('../src/services/PermissionService', () => ({
    PermissionService: {
        checkAudioPermission: jest.fn().mockReturnValue(Promise.resolve(true)),
        requestAudioPermission: jest.fn().mockReturnValue(Promise.resolve(true)),
    },
}));

jest.mock('@dr.pogodin/react-native-fs', () => ({
    exists: jest.fn(async () => false),
    readFile: jest.fn(async () => ''),
    copyFile: jest.fn(async () => {}),
    CachesDirectoryPath: '/mock/cache',
}));

import { formatDuration } from '../src/utils/formatUtils';
import { useAudioStore, flushPendingWrites } from '../src/store/audioStore';
import { useFavoritesStore } from '../src/store/favoritesStore';
import { AudioMediaService } from '../src/services/AudioMediaService';
import { parseLrc } from '../src/services/LyricsService';
import { AudioTrack } from '../src/types';

describe('Audio Player Utilities and Store', () => {
    describe('formatDuration for audio tracks', () => {
        it('formats zero or negative durations cleanly', () => {
            expect(formatDuration(0)).toBe('00:00');
            expect(formatDuration(-10)).toBe('00:00');
        });

        it('formats MM:SS correctly for songs under an hour', () => {
            expect(formatDuration(45)).toBe('00:45');
            expect(formatDuration(215)).toBe('03:35');
            expect(formatDuration(3599)).toBe('59:59');
        });

        it('formats HH:MM:SS correctly for long mixes/podcasts over an hour', () => {
            expect(formatDuration(3600)).toBe('1:00:00');
            expect(formatDuration(3665)).toBe('1:01:05');
        });
    });

    describe('useAudioStore queue operations', () => {
        const dummyTrack1: AudioTrack = {
            id: '101',
            title: 'Track One',
            artist: 'Artist A',
            album: 'Album X',
            albumId: '201',
            duration: 180,
            path: '/music/track1.mp3',
            uri: 'content://media/external/audio/media/101',
            size: 5000000,
            trackNumber: 1,
        };

        const dummyTrack2: AudioTrack = {
            id: '102',
            title: 'Track Two',
            artist: 'Artist A',
            album: 'Album X',
            albumId: '201',
            duration: 210,
            path: '/music/track2.mp3',
            uri: 'content://media/external/audio/media/102',
            size: 6000000,
            trackNumber: 2,
        };

        const dummyTrack3: AudioTrack = {
            id: '103',
            title: 'Track Three',
            artist: 'Artist B',
            album: 'Album Y',
            albumId: '202',
            duration: 240,
            path: '/music/track3.mp3',
            uri: 'content://media/external/audio/media/103',
            size: 7000000,
            trackNumber: 1,
        };

        beforeEach(() => {
            useAudioStore.getState().clearQueue();
            useAudioStore.setState({ shuffle: false, repeatMode: 'off', equalizerPreset: 'flat', position: 0 });
            jest.clearAllMocks();
        });

        afterEach(() => {
            useAudioStore.getState().setSleepTimer('off');
            flushPendingWrites();
        });

        afterAll(() => {
            useAudioStore.getState().setSleepTimer('off');
            flushPendingWrites();
        });

        it('sets current track and queue on playTrack', async () => {
            await useAudioStore.getState().playTrack(dummyTrack1, [dummyTrack1, dummyTrack2, dummyTrack3]);
            const state = useAudioStore.getState();
            expect(state.currentTrack?.id).toBe('101');
            expect(state.queue.length).toBe(3);
            expect(state.currentIndex).toBe(0);
            expect(state.isPlaying).toBe(true);
        });

        it('cycles repeat mode off -> all -> one -> off', async () => {
            expect(useAudioStore.getState().repeatMode).toBe('off');
            await useAudioStore.getState().toggleRepeatMode();
            expect(useAudioStore.getState().repeatMode).toBe('all');
            await useAudioStore.getState().toggleRepeatMode();
            expect(useAudioStore.getState().repeatMode).toBe('one');
            await useAudioStore.getState().toggleRepeatMode();
            expect(useAudioStore.getState().repeatMode).toBe('off');
        });

        it('toggles shuffle mode', async () => {
            const initial = useAudioStore.getState().shuffle;
            await useAudioStore.getState().toggleShuffle();
            expect(useAudioStore.getState().shuffle).toBe(!initial);
        });

        it('skips to specific index', async () => {
            await useAudioStore.getState().playQueue([dummyTrack1, dummyTrack2, dummyTrack3], 0);
            await useAudioStore.getState().skipToIndex(2);
            expect(useAudioStore.getState().currentIndex).toBe(2);
            expect(useAudioStore.getState().currentTrack?.id).toBe('103');
        });

        it('persists and changes equalizer preset', async () => {
            expect(useAudioStore.getState().equalizerPreset).toBe('flat');
            await useAudioStore.getState().setEqualizerPreset('bass_boost');
            expect(useAudioStore.getState().equalizerPreset).toBe('bass_boost');
            expect(NativeModules.GlideAudioPlayerModule.setAudioEqualizer).toHaveBeenCalled();
        });

        it('does not truncate large queues beyond 100 items when persisting and uses setQueueByIds', async () => {
            const largeQueue: AudioTrack[] = Array.from({ length: 150 }, (_, i) => ({
                ...dummyTrack1,
                id: `track-${i}`,
                title: `Song ${i}`,
            }));

            await useAudioStore.getState().playQueue(largeQueue, 120);
            const state = useAudioStore.getState();
            expect(state.queue.length).toBe(150);
            expect(state.currentIndex).toBe(120);
            expect(NativeModules.GlideAudioPlayerModule.setQueueByIds).toHaveBeenCalledWith(
                largeQueue.map((t) => t.id),
                120,
                0,
                true,
                false,
                'off',
                expect.arrayContaining([expect.any(Number)])
            );
        });

        it('safely hydrates queue from MMKV without evaluation freeze', () => {
            mockMMKVStore.set('@glide_audio_queue', JSON.stringify([dummyTrack1, dummyTrack2]));
            useAudioStore.setState({ queue: [], currentTrack: null });
            useAudioStore.getState().hydrateQueue();

            const state = useAudioStore.getState();
            expect(state.queue.length).toBe(2);
            expect(state.queue[0].id).toBe('101');
        });

        it('preserves position when track index has not changed in _setTrackChanged', () => {
            useAudioStore.setState({
                queue: [dummyTrack1, dummyTrack2],
                currentIndex: 0,
                currentTrack: dummyTrack1,
                position: 45,
            });

            // Re-fire track change for index 0 (e.g. metadata or shuffle toggle)
            useAudioStore.getState()._setTrackChanged({ currentIndex: 0, duration: 180 });
            expect(useAudioStore.getState().position).toBe(45);

            // Change to index 1
            useAudioStore.getState()._setTrackChanged({ currentIndex: 1, duration: 210 });
            expect(useAudioStore.getState().position).toBe(0);
        });

        it('shows the song native is playing even when its index disagrees', () => {
            useAudioStore.setState({
                queue: [dummyTrack1, dummyTrack2],
                currentIndex: 0,
                currentTrack: dummyTrack1,
            });

            // Native auto-skipped past an unplayable item, so its queue is one shorter
            useAudioStore.getState()._setTrackChanged({ currentIndex: 0, trackId: dummyTrack2.id });
            expect(useAudioStore.getState().currentTrack?.id).toBe(dummyTrack2.id);
            expect(useAudioStore.getState().currentIndex).toBe(1);
        });

        it('keeps the current song when native plays one that is not in the queue', () => {
            useAudioStore.setState({
                queue: [dummyTrack1, dummyTrack2],
                currentIndex: 0,
                currentTrack: dummyTrack1,
            });

            // Android Auto started its own queue; index 1 here is not what is playing
            useAudioStore.getState()._setTrackChanged({ currentIndex: 1, trackId: 'from-auto' });
            expect(useAudioStore.getState().currentTrack?.id).toBe(dummyTrack1.id);
        });

        it('passes equalizer bands and settings to native setQueue', async () => {
            await useAudioStore.getState().setEqualizerPreset('rock');
            await useAudioStore.getState().playQueue([dummyTrack1], 0);

            expect(NativeModules.GlideAudioPlayerModule.setQueue).toHaveBeenCalledWith(
                expect.any(Array),
                0,
                0,
                true,
                false,
                'off',
                expect.arrayContaining([expect.any(Number)])
            );
        });

        it('separates queue persistence from playback state persistence', async () => {
            await useAudioStore.getState().playQueue([dummyTrack1, dummyTrack2], 1);

            const persistedQueue = mockMMKVStore.get('@glide_audio_queue');
            expect(persistedQueue).toBeDefined();
            const parsedQueue = JSON.parse(persistedQueue!);
            expect(parsedQueue.length).toBe(2);

            await useAudioStore.getState().seekTo(30);
            await new Promise((r) => setTimeout(r, 600));

            const persistedState = mockMMKVStore.get('@glide_audio_playback_state');
            expect(persistedState).toBeDefined();
            const parsedState = JSON.parse(persistedState!);
            expect(parsedState.currentIndex).toBe(1);
            expect(parsedState.position).toBe(30);
        });

        it('clears queue and persists empty queue without reviving old data', async () => {
            await useAudioStore.getState().playQueue([dummyTrack1, dummyTrack2], 0);
            expect(useAudioStore.getState().queue.length).toBe(2);

            await useAudioStore.getState().clearQueue();
            expect(useAudioStore.getState().queue.length).toBe(0);

            const persistedQueue = mockMMKVStore.get('@glide_audio_queue');
            expect(persistedQueue).toBe('[]');
        });

        it('saves and updates queueSource when queue is played', async () => {
            await useAudioStore.getState().playTrack(dummyTrack1, [dummyTrack1], 'Album: Thriller');
            expect(useAudioStore.getState().queueSource).toBe('Album: Thriller');

            await useAudioStore.getState().playQueue([dummyTrack1, dummyTrack2], 0, 'Artist: Queen');
            expect(useAudioStore.getState().queueSource).toBe('Artist: Queen');
        });

        it('inserts track immediately next in queue with playNext via addMediaItem', async () => {
            await useAudioStore.getState().playQueue([dummyTrack1, dummyTrack3], 0);
            (NativeModules.GlideAudioPlayerModule.addMediaItem as jest.Mock<any>).mockClear();
            await useAudioStore.getState().playNext(dummyTrack2);

            const state = useAudioStore.getState();
            expect(state.queue.length).toBe(3);
            expect(state.queue[1].id).toBe('102');
            expect(state.queue[2].id).toBe('103');
            expect(NativeModules.GlideAudioPlayerModule.addMediaItem).toHaveBeenCalledWith(1, dummyTrack2);
        });

        it('appends track to end of queue with addToQueue via addMediaItem', async () => {
            await useAudioStore.getState().playQueue([dummyTrack1, dummyTrack2], 0);
            (NativeModules.GlideAudioPlayerModule.addMediaItem as jest.Mock<any>).mockClear();
            await useAudioStore.getState().addToQueue(dummyTrack3);

            const state = useAudioStore.getState();
            expect(state.queue.length).toBe(3);
            expect(state.queue[2].id).toBe('103');
            expect(NativeModules.GlideAudioPlayerModule.addMediaItem).toHaveBeenCalledWith(2, dummyTrack3);
        });

        it('removes track from queue with removeFromQueue via removeMediaItem and updates indices', async () => {
            await useAudioStore.getState().playQueue([dummyTrack1, dummyTrack2, dummyTrack3], 1);
            (NativeModules.GlideAudioPlayerModule.removeMediaItem as jest.Mock<any>).mockClear();
            // Removing track at index 0 (before current index 1)
            await useAudioStore.getState().removeFromQueue(0);

            const state = useAudioStore.getState();
            expect(state.queue.length).toBe(2);
            expect(state.currentIndex).toBe(0);
            expect(state.currentTrack?.id).toBe('102');
            expect(NativeModules.GlideAudioPlayerModule.removeMediaItem).toHaveBeenCalledWith(0);
        });

        it('reorders queue with moveQueueItem via moveMediaItem', async () => {
            await useAudioStore.getState().playQueue([dummyTrack1, dummyTrack2, dummyTrack3], 0);
            (NativeModules.GlideAudioPlayerModule.moveMediaItem as jest.Mock<any>).mockClear();
            await useAudioStore.getState().moveQueueItem(0, 2);

            const state = useAudioStore.getState();
            expect(state.queue[0].id).toBe('102');
            expect(state.queue[2].id).toBe('101');
            expect(state.currentIndex).toBe(2);
            expect(NativeModules.GlideAudioPlayerModule.moveMediaItem).toHaveBeenCalledWith(0, 2);
        });

        it('activates and clears sleep timer via native calls', () => {
            (NativeModules.GlideAudioPlayerModule.setSleepTimer as jest.Mock<any>).mockClear();
            (NativeModules.GlideAudioPlayerModule.clearSleepTimer as jest.Mock<any>).mockClear();

            useAudioStore.getState().setSleepTimer(15);
            expect(useAudioStore.getState().sleepTimerMode).toBe('time');
            expect(useAudioStore.getState().sleepTimerRemaining).toBe(15 * 60);
            expect(NativeModules.GlideAudioPlayerModule.setSleepTimer).toHaveBeenCalledWith(15, false);

            useAudioStore.getState().setSleepTimer('end_of_track');
            expect(useAudioStore.getState().sleepTimerMode).toBe('end_of_track');
            expect(NativeModules.GlideAudioPlayerModule.setSleepTimer).toHaveBeenCalledWith(0, true);

            useAudioStore.getState().setSleepTimer('off');
            expect(useAudioStore.getState().sleepTimerMode).toBe('off');
            expect(useAudioStore.getState().sleepTimerRemaining).toBe(0);
            expect(NativeModules.GlideAudioPlayerModule.clearSleepTimer).toHaveBeenCalled();
        });
    });

    describe('FavoritesStore operations', () => {
        beforeEach(() => {
            mockMMKVStore.clear();
        });

        it('toggles favorites and persists to MMKV', () => {
            expect(useFavoritesStore.getState().isFavorite('song-1')).toBe(false);

            const isFavNow = useFavoritesStore.getState().toggleFavorite('song-1');
            expect(isFavNow).toBe(true);
            expect(useFavoritesStore.getState().isFavorite('song-1')).toBe(true);
            expect(mockMMKVStore.get('@glide_audio_favorites')).toContain('song-1');

            const unFav = useFavoritesStore.getState().toggleFavorite('song-1');
            expect(unFav).toBe(false);
            expect(useFavoritesStore.getState().isFavorite('song-1')).toBe(false);
        });
    });

    describe('LyricsService parseLrc', () => {
        it('parses standard single-tag lyrics correctly', () => {
            const lrc = `
                [00:12.50]Line one of lyrics
                [01:05.10]Line two of lyrics
            `;
            const parsed = parseLrc(lrc);
            expect(parsed.length).toBe(2);
            expect(parsed[0].time).toBeCloseTo(12.5);
            expect(parsed[0].text).toBe('Line one of lyrics');
            expect(parsed[1].time).toBeCloseTo(65.1);
            expect(parsed[1].text).toBe('Line two of lyrics');
        });

        it('handles multi-tag lyrics on the same line', () => {
            const lrc = '[00:10.00][00:20.00]Repeated chorus';
            const parsed = parseLrc(lrc);
            expect(parsed.length).toBe(2);
            expect(parsed[0].time).toBe(10);
            expect(parsed[1].time).toBe(20);
            expect(parsed[0].text).toBe('Repeated chorus');
            expect(parsed[1].text).toBe('Repeated chorus');
        });

        it('ignores lines without timestamp brackets', () => {
            const lrc = `
                [ti:Song Title]
                [ar:Artist Name]
                Plain comment line
                [00:05.00]Real line
            `;
            const parsed = parseLrc(lrc);
            expect(parsed.length).toBe(1);
            expect(parsed[0].text).toBe('Real line');
        });

        it('parses timestamps with one-digit fractions like [00:12.5]', () => {
            const lrc = '[00:12.5]One digit fraction';
            const parsed = parseLrc(lrc);
            expect(parsed.length).toBe(1);
            expect(parsed[0].time).toBeCloseTo(12.5);
            expect(parsed[0].text).toBe('One digit fraction');
        });
    });

    describe('AudioMediaService grouping from songs', () => {
        const sampleSongs: AudioTrack[] = [
            {
                id: '1',
                title: 'Song A',
                artist: 'Artist 1',
                album: 'Album 1',
                albumId: 'alb-1',
                duration: 180,
                path: '/music/rock/songA.mp3',
                uri: 'u1',
                size: 100,
                trackNumber: 2,
                year: 2021,
            },
            {
                id: '2',
                title: 'Song B',
                artist: 'Artist 1',
                album: 'Album 1',
                albumId: 'alb-1',
                duration: 200,
                path: '/music/rock/songB.mp3',
                uri: 'u2',
                size: 100,
                trackNumber: 1,
                year: 2021,
            },
            {
                id: '3',
                title: 'Song C',
                artist: 'Artist 2',
                album: 'Album 2',
                albumId: 'alb-2',
                duration: 220,
                path: '/music/pop/songC.mp3',
                uri: 'u3',
                size: 100,
                trackNumber: 1,
                year: 2022,
            },
        ];

        beforeEach(() => {
            AudioMediaService.invalidateCache();
            (NativeModules.MediaStoreAudioModule.getSongs as jest.Mock<any>).mockResolvedValue(sampleSongs);
        });

        it('groups songs into albums correctly and stores firstSongUri', async () => {
            const albums = await AudioMediaService.getAlbums();
            expect(albums.length).toBe(2);
            const album1 = albums.find((a) => a.id === 'alb-1');
            expect(album1?.numberOfSongs).toBe(2);
            expect(album1?.artist).toBe('Artist 1');
            expect(album1?.firstSongUri).toBe('u1');
        });

        it('fetches library in a single pass with getLibrary', async () => {
            const library = await AudioMediaService.getLibrary();
            expect(library.tracks.length).toBe(3);
            expect(library.albums.length).toBe(2);
            expect(library.artists.length).toBe(2);
            const album1 = library.albums.find((a) => a.id === 'alb-1');
            expect(album1?.firstSongUri).toBe('u1');
        });

        it('groups songs into artists correctly', async () => {
            const artists = await AudioMediaService.getArtists();
            expect(artists.length).toBe(2);
            const artist1 = artists.find((a) => a.artist === 'Artist 1');
            expect(artist1?.numberOfTracks).toBe(2);
            expect(artist1?.numberOfAlbums).toBe(1);
        });

        it('sorts album songs by track number', async () => {
            const songs = await AudioMediaService.getSongsByAlbum('alb-1');
            expect(songs.length).toBe(2);
            expect(songs[0].trackNumber).toBe(1);
            expect(songs[1].trackNumber).toBe(2);
        });

        it('groups songs into folders by directory path', () => {
            const folders = AudioMediaService.groupFolders(sampleSongs);
            expect(folders.length).toBe(2);
            const rockFolder = folders.find((f) => f.name === 'rock');
            expect(rockFolder?.numberOfSongs).toBe(2);
            expect(rockFolder?.path).toBe('/music/rock');
            const popFolder = folders.find((f) => f.name === 'pop');
            expect(popFolder?.numberOfSongs).toBe(1);
            expect(popFolder?.path).toBe('/music/pop');
        });
    });
});
