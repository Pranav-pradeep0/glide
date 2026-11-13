import { useState, useMemo, useEffect, useRef, useCallback, type RefObject } from 'react';
import { AppState } from 'react-native';
import { formatTime } from './types';
import { RECAP_AVAILABLE } from '@/utils/constants';

const RECAP_INACTIVITY_THRESHOLD = 5 * 60 * 1000; // 5 minutes

interface UseResumePlaybackOptions {
    /** No saved position to offer: a stream with no history, or another app's, which sends its own. */
    noResume: boolean;
    resumePosition: number;
    savedDuration?: number;
    imdbId?: string;
    albumName?: string | null;
    isRecapEligible: boolean;
    recapChecked: boolean;
    recapVisible: boolean;
    isPaused: boolean;
    /** No prompt now: in PiP, or opened from it, where nothing can answer it. */
    promptBlocked: boolean;
    currentTimeRef: RefObject<number>;
    /** The long-pause prompt offers to resume from here, not from where the video was opened. */
    onPromptPosition: (seconds: number) => void;
    onPlay: () => void;
    onPause: () => void;
    onSeekToStart: () => void;
    onRecap: () => void;
    onRestartPersist: () => void;
}

export function useResumePlayback({
    noResume,
    resumePosition,
    savedDuration,
    imdbId,
    albumName,
    isRecapEligible,
    recapChecked,
    recapVisible,
    isPaused,
    promptBlocked,
    currentTimeRef,
    onPromptPosition,
    onPlay,
    onPause,
    onSeekToStart,
    onRecap,
    onRestartPersist,
}: UseResumePlaybackOptions) {
    const shouldResume = useMemo(() => {
        return !noResume && !!(resumePosition && resumePosition > 15);
    }, [resumePosition, noResume]);

    // Blocked means resume: the media already opens at the saved position.
    const [resumeModalVisible, setResumeModalVisible] = useState(shouldResume && !promptBlocked);
    const lastPauseTimeRef = useRef<number | null>(null);

    const resumeModalData = useMemo(() => {
        if (!resumePosition) { return null; }

        const remaining = savedDuration ? Math.max(0, savedDuration - resumePosition) : 0;
        const finishBy = savedDuration
            ? new Date(Date.now() + remaining * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : undefined;

        return {
            formattedTime: formatTime(resumePosition),
            remainingTime: savedDuration ? remaining : undefined,
            finishByTime: finishBy,
            showRecap: RECAP_AVAILABLE && !noResume && resumePosition > 120 && (!!imdbId || !!albumName)
                && (isRecapEligible || !recapChecked),
            recapChecking: !recapChecked,
        };
    }, [resumePosition, savedDuration, imdbId, albumName, noResume, isRecapEligible, recapChecked]);

    // A long break, paused 5+ minutes: offer Continue watching (and Recap). Time spent in the
    // prompt or in Recap is not a break, or Resume after a slow read would ask again.
    const promptAfterBreak = useCallback(() => {
        const since = lastPauseTimeRef.current;
        lastPauseTimeRef.current = null;
        if (since === null || noResume || promptBlocked || Date.now() - since <= RECAP_INACTIVITY_THRESHOLD) { return false; }
        onPromptPosition(currentTimeRef.current);
        setResumeModalVisible(true);
        return true;
    }, [noResume, promptBlocked, onPromptPosition, currentTimeRef]);

    useEffect(() => {
        if (resumeModalVisible || recapVisible) { lastPauseTimeRef.current = null; return; }
        if (isPaused) { lastPauseTimeRef.current ??= Date.now(); return; }
        // Played after a break nobody was asked about (no return to the app in between).
        if (promptAfterBreak()) { onPause(); }
    }, [isPaused, resumeModalVisible, recapVisible, promptAfterBreak, onPause]);

    // Back in the app after a long time away (the video paused when it was minimised): ask
    // now, rather than after Play, which used to start the video only to pause it again.
    const pausedRef = useRef(isPaused);
    pausedRef.current = isPaused;
    useEffect(() => {
        const sub = AppState.addEventListener('change', (state) => {
            if (state === 'active' && pausedRef.current) { promptAfterBreak(); }
        });
        return () => sub.remove();
    }, [promptAfterBreak]);

    // Closing the prompt any way (X, outside, Back) carries on playing, like Resume.
    const closeResumeModal = useCallback(() => {
        setResumeModalVisible(false);
        onPlay();
    }, [onPlay]);

    // The screen passes fresh closures each render; a ref keeps this handler (and the modal's memo) stable.
    const actionsRef = useRef({ onPlay, onRestartPersist, onSeekToStart, onRecap });
    actionsRef.current = { onPlay, onRestartPersist, onSeekToStart, onRecap };
    const handleResumeModalAction = useCallback((action: 'resume' | 'restart' | 'recap') => {
        const actions = actionsRef.current;
        if (action === 'resume') {
            setResumeModalVisible(false);
            actions.onPlay();
        } else if (action === 'restart') {
            actions.onRestartPersist();
            setResumeModalVisible(false);
            actions.onSeekToStart();
            actions.onPlay();
        } else if (action === 'recap') {
            actions.onRecap();
        }
    }, []);

    return {
        resumeModalVisible,
        setResumeModalVisible,
        closeResumeModal,
        resumeModalData,
        handleResumeModalAction,
    };
}
