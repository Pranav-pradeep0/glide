/**
 * usePlayerCore Hook
 */


import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GlidePlayerRef } from '@/components/VideoPlayer/GlidePlayer';
import { useSharedValue, useFrameCallback } from 'react-native-reanimated';
import { getResumablePosition } from '@/utils/playbackResume';
import {
    PlayerState,
    PlayerLoadData,
    PlayerProgressData,
    PlayerSeekEvent,
    PlayerBufferingEvent,
    UsePlayerCoreReturn,
    PLAYER_CONSTANTS,
} from './types';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

/** Minimum ms between live preview seeks while scrubbing. */
const LIVE_PREVIEW_THROTTLE_MS = 40;
const SEEK_SETTLE_WINDOW_MS = 700;
const SEEK_CONFIRM_EPSILON_SEC = 0.35;
const PLAY_PAUSE_INTENT_GUARD_MS = 900;

// ─── INITIAL STATE ────────────────────────────────────────────────────────────

const initialPlayerState: PlayerState = {
    paused: false,
    duration: 0,
    isVideoLoaded: false,
    isPlaying: false,
    isBuffering: false,
    isSeeking: false,
    playerStopped: false,
    errorText: null,
};

// ─── HOOK OPTIONS ─────────────────────────────────────────────────────────────

interface UsePlayerCoreOptions {
    videoPath: string;
    onAudioTracksLoaded?: (tracks: Array<{ id: number; name: string }>) => void;
    onSubtitleTracksLoaded?: (tracks: any[]) => void;
    onPlaybackPositionRestore?: (position: number) => void;
    getResumePosition?: () => number | null;
    repeat?: boolean;
    sleepTimer?: number | null;
    onSleepTimerEnd?: () => void;
    onProgressSave?: () => void;
    initialPaused?: boolean;
    playbackRate?: number;
}

// ─── HOOK ─────────────────────────────────────────────────────────────────────

export function usePlayerCore(options: UsePlayerCoreOptions): UsePlayerCoreReturn {
    const {
        onAudioTracksLoaded,
        onSubtitleTracksLoaded,
        getResumePosition,
        repeat = false,
        sleepTimer = null,
        onSleepTimerEnd,
        onProgressSave,
        initialPaused = false,
    } = options;

    // ── REFS ─────────────────────────────────────────────────────────────────

    const videoRef = useRef< GlidePlayerRef | null>(null);

    // Time tracking — refs are source of truth; state drives display only
    const currentTimeRef = useRef<number>(0);

    // Resume position (cleared after first use)
    const resumePosRef = useRef<number | null>(getResumePosition?.() ?? null);

    // Buffering debounce
    const bufferingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Live preview throttle
    const livePreviewTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastLivePreviewAtRef = useRef<number>(0);

    // Seek settling
    const seekSettledUntilRef = useRef<number>(0);
    const pendingCommittedSeekRef = useRef<number | null>(null);
    const lastPauseIntentAtRef = useRef<number>(0);
    const lastPauseIntentValueRef = useRef<boolean>(initialPaused);

    // Player stopped flag
    const playerStoppedRef = useRef<boolean>(false);

    // ── STATE ─────────────────────────────────────────────────────────────────

    const [state, setState] = useState<PlayerState>({
        ...initialPlayerState,
        paused: initialPaused,
    });

    // ── SHARED VALUES (Reanimated gesture worklets) ───────────────────────────

    const currentTimeShared = useSharedValue(0);
    const durationShared = useSharedValue(0);
    const isScrubbingShared = useSharedValue(false);

    const isPlayingShared = useSharedValue(false);
    const lastSyncTimestamp = useSharedValue(0);
    const lastSyncPosition = useSharedValue(0);
    const playbackRateShared = useSharedValue(options.playbackRate ?? 1.0);

    useEffect(() => {
        const now = Date.now();
        lastSyncPosition.value = currentTimeRef.current;
        lastSyncTimestamp.value = now;
        currentTimeShared.value = currentTimeRef.current;
        playbackRateShared.value = options.playbackRate ?? 1.0;
    }, [options.playbackRate, playbackRateShared, currentTimeShared, lastSyncPosition,
        lastSyncTimestamp]);

    // ── FRAME CALLBACK ────────────────────────────────────────────────────────

    useFrameCallback(() => {
        if (isPlayingShared.value && !isScrubbingShared.value && durationShared.value > 0) {
            const now = Date.now();
            const elapsed = (now - lastSyncTimestamp.value) / 1000;
            let predicted = lastSyncPosition.value + elapsed * playbackRateShared.value;
            if (predicted > durationShared.value) {predicted = durationShared.value;}
            currentTimeShared.value = predicted;
        }
    });

    /**
     * Duration is the only thing progress and seek events put into React state, and both
     * must keep the shared value in step with it. Anything below the threshold is decoder
     * jitter, not a real change.
     */
    const syncDuration = useCallback((durSec: number) => {
        if (Math.abs(durSec - durationShared.value) <= 1.0) {return;}
        durationShared.value = durSec;
        setState(prev => ({ ...prev, duration: durSec }));
    }, [durationShared]);

    // ═════════════════════════════════════════════════════════════════════════
    // SEEK IMPLEMENTATION
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * applySeekToNative — the single exit point for all seeks to native.
     * Every call reaches native as a seek command; nothing is deduplicated.
     */
    const applySeekToNative = useCallback((timeInSeconds: number, isPreview: boolean = false) => {
        if (!state.isVideoLoaded || !state.duration || state.duration === 0) {
            if (__DEV__) {console.warn('[SEEK] applySeekToNative dropped — no duration yet');}
            return;
        }

        const clamped = Math.max(0, Math.min(state.duration, timeInSeconds));

        const player = videoRef.current;
        if (player) {
            if (isPreview) {
                player.previewSeek(clamped);
            } else {
                player.seek(clamped);
            }
        } else if (__DEV__) {
            console.warn('[SEEK] applySeekToNative — no player instance');
        }
    }, [state.isVideoLoaded, state.duration]);

    /**
     * previewSeek — called continuously while the user drags the seekbar.
     * Updates UI refs immediately; throttles native seeks.
     */
    const previewSeek = useCallback((timeInSeconds: number) => {
        const clamped = Math.max(0, Math.min(state.duration || 0, timeInSeconds));

        currentTimeRef.current = clamped;
        currentTimeShared.value = clamped;
        lastSyncPosition.value = clamped;
        lastSyncTimestamp.value = Date.now();

        const now = Date.now();
        const sinceLast = now - lastLivePreviewAtRef.current;

        if (sinceLast >= LIVE_PREVIEW_THROTTLE_MS) {
            applySeekToNative(clamped, true);
            lastLivePreviewAtRef.current = now;
            if (livePreviewTimerRef.current) {
                clearTimeout(livePreviewTimerRef.current);
                livePreviewTimerRef.current = null;
            }
        } else {
            if (livePreviewTimerRef.current) {clearTimeout(livePreviewTimerRef.current);}
            const wait = LIVE_PREVIEW_THROTTLE_MS - sinceLast;
            livePreviewTimerRef.current = setTimeout(() => {
                livePreviewTimerRef.current = null;
                lastLivePreviewAtRef.current = Date.now();
                applySeekToNative(clamped, true);
            }, wait);
        }
    }, [state.duration, currentTimeShared, lastSyncPosition, lastSyncTimestamp, applySeekToNative]);


    /**
     * commitSeek — the single entry point for a finished seek.
     *
     * Returns whether the seek was accepted. Callers that display the requested time must
     * honour a `false`: until the duration is known, `applySeekToNative` drops the seek, so
     * anything already shown is a position the player will never move to. That is the
     * whole of the "HUD shows 00:00 when you skip right after opening a video" report —
     * the jump handlers clamp against `duration`, which is 0 for roughly 430 ms after the
     * source opens, so a skip in that window asks for 0, is dropped, and leaves the HUD
     * announcing a seek to the start that never happened.
     */
    const commitSeek = useCallback((timeInSeconds: number): boolean => {
        if (livePreviewTimerRef.current) {
            clearTimeout(livePreviewTimerRef.current);
            livePreviewTimerRef.current = null;
        }

        const duration = state.duration || 0;
        if (!state.isVideoLoaded || duration <= 0) {
            // Refusing the seek must still end the gesture. The touch is over either way,
            // and leaving these set latches the scrubber in its active state at the
            // touched position: `isScrubbing` also suppresses playing/paused handling and
            // position updates, so the HUD then reports 0:00 while playback runs on.
            // Only the playhead and the HUD value are withheld, never the gesture's end.
            isScrubbingShared.value = false;
            setState(prev => (prev.isSeeking ? { ...prev, isSeeking: false } : prev));
            if (__DEV__) {console.warn('[SEEK] commitSeek refused — no duration yet');}
            return false;
        }

        const clamped = Math.max(0, Math.min(duration, timeInSeconds));

        currentTimeRef.current = clamped;
        currentTimeShared.value = clamped;
        lastSyncPosition.value = clamped;
        lastSyncTimestamp.value = Date.now();
        lastLivePreviewAtRef.current = Date.now();

        applySeekToNative(clamped);

        pendingCommittedSeekRef.current = clamped;
        seekSettledUntilRef.current = Date.now() + SEEK_SETTLE_WINDOW_MS;

        playerStoppedRef.current = false;

        setState(prev => ({
            ...prev,
            isSeeking: false,
            // When reviving from stopped/ended state, also clear paused so React
            // doesn't re-send paused=true to native and immediately pause the
            // newly-created player.
            ...(prev.playerStopped
                ? { playerStopped: false, paused: false, isPlaying: true }
                : {}),
        }));

        if (state.playerStopped) {
            isPlayingShared.value = true;
            if (__DEV__) {console.log('[SEEK] commitSeek: reviving from stopped state');}
        }

        isScrubbingShared.value = false;
        return true;
    }, [state.duration, state.isVideoLoaded, state.playerStopped, applySeekToNative,
        currentTimeShared, lastSyncPosition, lastSyncTimestamp, isScrubbingShared,
        isPlayingShared]);

    /** setIsSeeking — marks scrub start/end for UI feedback. */
    const setIsSeeking = useCallback((seeking: boolean) => {
        isScrubbingShared.value = seeking;
        setState(prev => ({ ...prev, isSeeking: seeking }));
        if (__DEV__) {console.log('[SEEK] setIsSeeking=' + seeking);}
    }, [isScrubbingShared]);

    /** clearResumePosition — prevents handleLoad from restoring the saved position. */
    const clearResumePosition = useCallback(() => {
        resumePosRef.current = null;
        if (__DEV__) {console.log('[SEEK] clearResumePosition');}
    }, []);

    // ═════════════════════════════════════════════════════════════════════════
    // PLAYBACK CONTROLS
    // ═════════════════════════════════════════════════════════════════════════

    const play = useCallback(() => {
        lastPauseIntentValueRef.current = false;
        lastPauseIntentAtRef.current = Date.now();
        playerStoppedRef.current = false;
        isPlayingShared.value = true;

        // Native restarts an ended video on play (GlidePlayerView.setPaused); match it here.
        if (state.playerStopped) {
            currentTimeRef.current = 0;
            currentTimeShared.value = 0;
            lastSyncPosition.value = 0;
            lastSyncTimestamp.value = Date.now();
        }
        // Keep the existing "near end" check as secondary guard
        else if (state.duration > 0 && Math.abs(currentTimeRef.current - state.duration) < 1.0) {
            currentTimeRef.current = 0;
            currentTimeShared.value = 0;
            lastSyncPosition.value = 0;
            lastSyncTimestamp.value = Date.now();
        }

        setState(prev => ({
            ...prev,
            paused: false,
            isPlaying: true,
            playerStopped: false,
        }));
    }, [state.playerStopped, state.duration, currentTimeShared, isPlayingShared,
        lastSyncPosition, lastSyncTimestamp]);

    const pause = useCallback(() => {
        if (__DEV__) {console.log('[CONTROL] pause() | currentTime=' + currentTimeRef.current.toFixed(2));}
        lastPauseIntentValueRef.current = true;
        lastPauseIntentAtRef.current = Date.now();

        isPlayingShared.value = false;

        setState(prev => ({
            ...prev,
            paused: true,
            isPlaying: false,
            isBuffering: false,
        }));

        onProgressSave?.();
    }, [onProgressSave, isPlayingShared]);

    const stop = useCallback(() => {
        if (__DEV__) {console.log('[CONTROL] stop()');}
        lastPauseIntentValueRef.current = true;
        lastPauseIntentAtRef.current = Date.now();

        videoRef.current?.stopPlayer?.();
        isPlayingShared.value = false;

        setState(prev => ({
            ...prev,
            paused: true,
            isPlaying: false,
            isBuffering: false,
            playerStopped: true,
        }));
    }, [isPlayingShared]);

    const togglePlayPause = useCallback(() => {
        if (__DEV__) {console.log('[CONTROL] togglePlayPause | paused=' + state.paused);}
        if (state.paused) {play();} else {pause();}
    }, [state.paused, play, pause]);

    // ═════════════════════════════════════════════════════════════════════════
    // PLAYER EVENT HANDLERS
    // ═════════════════════════════════════════════════════════════════════════

    const handleLoad = useCallback((data: PlayerLoadData) => {
        const durationSec = (data.duration ?? 0) / 1000;

        if (durationSec <= 1) {
            if (__DEV__) {console.log('[LOAD] ignored — junk duration=' + durationSec + 's');}
            return;
        }

        if (__DEV__) {console.log('[LOAD] duration=' + durationSec.toFixed(2) + 's'
            + ' audioTracks=' + (data.audioTracks?.length ?? 0));}

        playerStoppedRef.current = false;
        setState(prev => ({
            ...prev,
            duration: durationSec,
            isVideoLoaded: true,
            playerStopped: false,
            errorText: null,
        }));

        durationShared.value = durationSec;


        if (data.audioTracks && data.audioTracks.length > 0 && onAudioTracksLoaded) {
            const tracks = data.audioTracks
                .filter(t => t.id !== -1)
                .map(t => ({ id: t.id, name: t.name || `Track ${t.id}`, isSelected: Boolean(t.isSelected) }));
            if (__DEV__) {console.log('[LOAD] audioTracks:', tracks.map(t => `${t.name}${t.isSelected ? ' (selected)' : ''}`).join(', '));}
            onAudioTracksLoaded(tracks);
        }

        if (data.subtitleTracks && data.subtitleTracks.length > 0 && onSubtitleTracksLoaded) {
            onSubtitleTracksLoaded(data.subtitleTracks);
        }

        const resumeTime = resumePosRef.current;
        if (resumeTime !== null) {
            resumePosRef.current = null;
        }
        const validResumeTime = getResumablePosition(resumeTime, durationSec);
        if (validResumeTime !== null) {
            // No seek. The player was told to open the demuxer at this offset via the source's
            // startTime, so by the time onLoad fires playback is already there. All that
            // is left is to align the UI's position refs with it.
            //
            // Previously seeking 100 ms after onLoad caused the request to drop during
            // player startup ramp, restarting playback from zero.
            if (__DEV__) {console.log('[LOAD] resume position=' + validResumeTime.toFixed(2) + 's (opened at offset)');}

            currentTimeRef.current = validResumeTime;
            currentTimeShared.value = validResumeTime;
            lastSyncPosition.value = validResumeTime;
            lastSyncTimestamp.value = Date.now();
        }
    }, [onAudioTracksLoaded, onSubtitleTracksLoaded, durationShared, currentTimeShared, lastSyncPosition,
        lastSyncTimestamp]);

    /**
     * handleProgress — Player position update during playback.
     */
    const handleProgress = useCallback((data: PlayerProgressData) => {
        if (isScrubbingShared.value) {return;}
        if (playerStoppedRef.current) {return;}

        const timeSec = (data.currentTime ?? 0) / 1000;
        const durSec = (data.duration ?? 0) / 1000;

        if (durSec <= 1) {return;}

        currentTimeRef.current = timeSec;

        const now = Date.now();

        const pendingCommittedSeek = pendingCommittedSeekRef.current;
        if (pendingCommittedSeek !== null) {
            const delta = Math.abs(timeSec - pendingCommittedSeek);
            if (delta <= SEEK_CONFIRM_EPSILON_SEC) {
                pendingCommittedSeekRef.current = null;
            } else if (now < seekSettledUntilRef.current) {
                return;
            } else {
                pendingCommittedSeekRef.current = null;
            }
        } else if (now < seekSettledUntilRef.current) {
            return;
        }

        const elapsed = (now - lastSyncTimestamp.value) / 1000;
        const predicted = lastSyncPosition.value + elapsed * playbackRateShared.value;
        const drift = Math.abs(timeSec - predicted);

        if (drift > 1.0 || !isPlayingShared.value) {
            lastSyncPosition.value = timeSec;
            lastSyncTimestamp.value = now;
            if (drift > 2.0) {currentTimeShared.value = timeSec;}
        }

        if (!state.paused && !isPlayingShared.value) {
            if (__DEV__) {console.log('[PROGRESS] waking up isPlayingShared');}
            isPlayingShared.value = true;
            lastSyncTimestamp.value = now;
            lastSyncPosition.value = timeSec;
        }

        // Position is already in currentTimeRef and currentTimeShared above, so a progress
        // tick renders nothing. Only a genuine duration change reaches React state.
        syncDuration(durSec);
    }, [currentTimeShared, syncDuration, isScrubbingShared, lastSyncPosition, lastSyncTimestamp,
        isPlayingShared, state.paused, playbackRateShared]);

    /**
     * handleEnd — video reached end.
     */

    const handleEnd = useCallback(() => {
        if (__DEV__) {console.log('[END] video ended | repeat=' + repeat + ' sleepTimer=' + sleepTimer);}

        if (repeat) {
            videoRef.current?.seek(0);
            currentTimeRef.current = 0;
            currentTimeShared.value = 0;
            lastSyncPosition.value = 0;
            lastSyncTimestamp.value = Date.now();
            setState(prev => ({ ...prev, isPlaying: true }));
            if (__DEV__) {console.log('[END] repeating from start');}
            return;
        }

        if (sleepTimer === -1) {
            if (__DEV__) {console.log('[END] sleep timer triggered');}
            onSleepTimerEnd?.();
        }

        const endTime = state.duration;
        playerStoppedRef.current = true;
        isPlayingShared.value = false;
        currentTimeShared.value = endTime;
        currentTimeRef.current = endTime;

        setState(prev => ({
            ...prev,
            paused: true,
            isPlaying: false,
            isBuffering: false,
            playerStopped: true,
        }));

        onProgressSave?.();
        if (__DEV__) {console.log('[END] playerStopped=true');}
    }, [repeat, sleepTimer, onSleepTimerEnd, onProgressSave, state.duration,
        currentTimeShared, lastSyncPosition, lastSyncTimestamp, isPlayingShared]);

    /**
     * handleError — Player error.
     */
    const handleError = useCallback((e: any) => {
        const msg = e?.error || e?.message || 'Playback error';
        if (__DEV__) {console.error('[ERROR] Player error:', e);}
        isPlayingShared.value = false;
        setState(prev => ({ ...prev, errorText: String(msg), isBuffering: false }));
    }, [isPlayingShared]);

    /**
     * handleBuffering — debounced buffering state.
     */
    const handleBuffering = useCallback((event: PlayerBufferingEvent | any) => {
        const isBuffering = typeof event === 'boolean'
            ? event
            : (typeof event?.isBuffering === 'boolean'
                ? event.isBuffering
                : ((typeof event?.bufferRate === 'number') ? event.bufferRate < 100 : false));

        if (bufferingTimeoutRef.current) {clearTimeout(bufferingTimeoutRef.current);}

        if (isBuffering) {
            setState(prev => ({ ...prev, isBuffering: true }));
        } else {
            bufferingTimeoutRef.current = setTimeout(() => {
                setState(prev => ({ ...prev, isBuffering: false }));
            }, PLAYER_CONSTANTS.BUFFERING_TIMEOUT_MS);
        }
    }, []);

    const handlePlaying = useCallback(() => {
        if (isScrubbingShared.value) {
            if (__DEV__) {console.log('[PLAYING] handlePlaying skipped — scrubbing');}
            return;
        }

        const now = Date.now();
        if (lastPauseIntentValueRef.current && (now - lastPauseIntentAtRef.current) < PLAY_PAUSE_INTENT_GUARD_MS) {
            return;
        }

        playerStoppedRef.current = false;
        isPlayingShared.value = true;
        lastSyncTimestamp.value = now;
        lastSyncPosition.value = currentTimeRef.current;

        setState(prev => {
            if (prev.isPlaying && !prev.paused) {return prev;} // already correct
            return {
                ...prev,
                isPlaying: true,
                paused: false,
                isBuffering: false,
                playerStopped: false,
            };
        });
    }, [isPlayingShared, lastSyncTimestamp, lastSyncPosition, isScrubbingShared]);

    const handlePaused = useCallback(() => {
        if (isScrubbingShared.value) {
            if (__DEV__) {console.log('[PLAYING] handlePaused skipped — scrubbing');}
            return;
        }

        const now = Date.now();
        if (!lastPauseIntentValueRef.current && (now - lastPauseIntentAtRef.current) < PLAY_PAUSE_INTENT_GUARD_MS) {
            return;
        }

        isPlayingShared.value = false;

        setState(prev => {
            if (!prev.isPlaying && prev.paused) {return prev;} // already correct
            return { ...prev, isPlaying: false, paused: true };
        });

        onProgressSave?.();
    }, [onProgressSave, isPlayingShared, isScrubbingShared]);

    /**
     * handleStopped — Player native Stopped event.
     */
    const handleStopped = useCallback(() => {
        if (__DEV__) {console.log('[PLAYING] handleStopped');}
        lastPauseIntentValueRef.current = true;
        lastPauseIntentAtRef.current = Date.now();

        playerStoppedRef.current = true;
        isPlayingShared.value = false;

        setState(prev => ({
            ...prev,
            paused: true,
            isPlaying: false,
            isBuffering: false,
            playerStopped: true,
        }));
    }, [isPlayingShared]);

    /**
     * handleSeek — Player native seek position change (e.g. from notification controls).
     */
    const handleSeek = useCallback((data: PlayerSeekEvent) => {
        if (isScrubbingShared.value) {return;}

        const timeSec = (data.currentTime ?? 0) / 1000;
        const durSec = (data.duration ?? 0) / 1000;

        if (durSec <= 1) {return;}

        const now = Date.now();
        const pendingCommittedSeek = pendingCommittedSeekRef.current;
        if (pendingCommittedSeek !== null) {
            const delta = Math.abs(timeSec - pendingCommittedSeek);
            if (delta <= SEEK_CONFIRM_EPSILON_SEC) {
                pendingCommittedSeekRef.current = null;
            } else if (now < seekSettledUntilRef.current) {
                return;
            } else {
                pendingCommittedSeekRef.current = null;
            }
        }

        currentTimeRef.current = timeSec;
        currentTimeShared.value = timeSec;
        lastSyncPosition.value = timeSec;
        lastSyncTimestamp.value = now;

        syncDuration(durSec);
    }, [currentTimeShared, syncDuration, lastSyncPosition, lastSyncTimestamp, isScrubbingShared]);

    // ── CLEANUP ───────────────────────────────────────────────────────────────

    useEffect(() => {
        return () => {
            if (bufferingTimeoutRef.current) {clearTimeout(bufferingTimeoutRef.current);}
            if (livePreviewTimerRef.current) {clearTimeout(livePreviewTimerRef.current);}
        };
    }, []);

    // ── RETURN ────────────────────────────────────────────────────────────────

    return useMemo(() => ({
        videoRef,
        currentTimeRef,
        state,
        currentTimeShared,
        durationShared,
        isScrubbingShared,
        play,
        pause,
        stop,
        togglePlayPause,
        previewSeek,
        commitSeek,
        setIsSeeking,
        clearResumePosition,
        handleLoad,
        handleProgress,
        handleEnd,
        handleError,
        handleBuffering,
        handlePlaying,
        handlePaused,
        handleStopped,
        handleSeek,
    }), [
        videoRef, currentTimeRef, state,
        currentTimeShared, durationShared, isScrubbingShared,
        play, pause, stop, togglePlayPause,
        previewSeek, commitSeek, setIsSeeking, clearResumePosition,
        handleLoad, handleProgress, handleEnd, handleError,
        handleBuffering, handlePlaying, handlePaused, handleStopped, handleSeek,
    ]);
}

export default usePlayerCore;
export { initialPlayerState };


