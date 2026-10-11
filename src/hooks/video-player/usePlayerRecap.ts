import { useState, useRef, useEffect, useCallback } from 'react';
import { SubtitleCue } from '@/types';
import { SubtitleTrack } from './types';
import { RecapService } from '@/services/RecapService';
import { RECAP_AVAILABLE } from '@/utils/constants';

interface UsePlayerRecapOptions {
    videoPath: string;
    videoName: string;
    cleanTitle?: string;
    albumName?: string | null;
    imdbId?: string;
    isNetworkStream: boolean;
    resumePosition: number;
    subtitleTracks: SubtitleTrack[];
    subtitleTracksReady: boolean;
    subtitleCues: SubtitleCue[];
    onPause: () => void;
    onDismissResumeModal: () => void;
    showToast: (msg: string) => void;
}

export function usePlayerRecap({
    videoPath,
    videoName,
    cleanTitle,
    albumName,
    imdbId,
    isNetworkStream,
    resumePosition,
    subtitleTracks,
    subtitleTracksReady,
    subtitleCues,
    onPause,
    onDismissResumeModal,
    showToast,
}: UsePlayerRecapOptions) {
    const [recapVisible, setRecapVisible] = useState(false);
    const [recapText, setRecapText] = useState<string | null>(null);
    const [isGeneratingRecap, setIsGeneratingRecap] = useState(false);
    const [recapLoadingMessage, setRecapLoadingMessage] = useState<string | undefined>(undefined);
    const [isRecapEligible, setIsRecapEligible] = useState(false);
    const [recapChecked, setRecapChecked] = useState(false);

    // A recap covers everything up to resumePosition; a later long-pause prompt moves it.
    useEffect(() => setRecapText(null), [resumePosition]);

    const isMounted = useRef(true);
    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, []);

    const subtitleCuesRef = useRef(subtitleCues);
    subtitleCuesRef.current = subtitleCues;

    useEffect(() => {
        let isActive = true;

        const evaluateRecapEligibility = async () => {
            if (!RECAP_AVAILABLE) {
                if (isActive) {
                    setIsRecapEligible(false);
                    setRecapChecked(true);
                }
                return;
            }

            if (
                isNetworkStream ||
                !resumePosition ||
                resumePosition <= 120 ||
                (!imdbId && !albumName)
            ) {
                if (isActive) {
                    setIsRecapEligible(false);
                    setRecapChecked(true);
                }
                return;
            }

            // An empty track list before discovery finishes means "not yet", not "none".
            if (!subtitleTracksReady) {
                if (isActive) {
                    setRecapChecked(false);
                }
                return;
            }

            const result = await RecapService.getRecapEligibility(
                videoPath,
                subtitleTracks,
                subtitleCuesRef.current,
                resumePosition
            );

            if (isActive) {
                setIsRecapEligible(result.eligible);
                setRecapChecked(true);
            }
        };

        evaluateRecapEligibility();

        return () => {
            isActive = false;
        };
    }, [
        videoPath,
        resumePosition,
        isNetworkStream,
        subtitleTracksReady,
        imdbId,
        albumName,
        subtitleTracks,
        subtitleCues,
    ]);

    const handleRecapTrigger = useCallback(async () => {
        if (isNetworkStream) { return; }

        if (!RECAP_AVAILABLE) {
            showToast('Recap is not available in this build');
            return;
        }

        if (recapText) {
            onPause();
            onDismissResumeModal();
            setRecapVisible(true);
            return;
        }

        if (!resumePosition) { return; }

        if (!isRecapEligible) {
            showToast('Recap unavailable for this title');
            return;
        }

        onPause();
        onDismissResumeModal();
        setRecapVisible(true);
        setIsGeneratingRecap(true);

        const setFeedback = (msg: string) => {
            if (isMounted.current) {
                setRecapLoadingMessage(msg);
            }
        };

        try {
            setFeedback('Analyzing subtitles...');
            const dialogue = await RecapService.getDialogueForRecap(
                videoPath,
                subtitleTracks,
                subtitleCuesRef.current,
                resumePosition,
                cleanTitle || videoName
            );

            if (!isMounted.current) { return; }

            if (!dialogue) {
                setRecapText(null);
                setRecapVisible(false);
                setIsGeneratingRecap(false);
                setRecapLoadingMessage(undefined);
                showToast('Not enough dialogue for a recap');
                return;
            }

            setFeedback('Generating your recap...');
            const summary = await RecapService.generateRecap(dialogue, cleanTitle || videoName);

            if (!isMounted.current) { return; }

            if (summary) {
                setRecapText(summary);
                setRecapLoadingMessage(undefined);
            } else {
                setRecapText(null);
                setRecapVisible(false);
                setRecapLoadingMessage(undefined);
                showToast('Recap generation failed');
            }
        } catch (error) {
            console.error('[usePlayerRecap] Recap error:', error);
            if (isMounted.current) {
                setRecapText(null);
                setRecapVisible(false);
                setRecapLoadingMessage(undefined);
                showToast('Recap generation error');
            }
        } finally {
            if (isMounted.current) {
                setIsGeneratingRecap(false);
            }
        }
    }, [
        isNetworkStream,
        recapText,
        resumePosition,
        isRecapEligible,
        onPause,
        onDismissResumeModal,
        showToast,
        videoPath,
        subtitleTracks,
        cleanTitle,
        videoName,
    ]);

    return {
        recapVisible,
        setRecapVisible,
        recapText,
        isGeneratingRecap,
        setIsGeneratingRecap,
        recapLoadingMessage,
        setRecapLoadingMessage,
        isRecapEligible,
        recapChecked,
        handleRecapTrigger,
    };
}
