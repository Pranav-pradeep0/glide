/**
 * Runs SubtitleAutoSync and applies its answer all-or-nothing.
 *
 * - Automatic: once per external subtitle, and only while the delay is untouched (0). An
 *   external .srt is where sync is usually wrong; a delay the user set is never overruled.
 * - Manual: the sync panel's Auto button, any subtitle, always applies a confident answer.
 *
 * An answer is dropped if the subtitle changed while it was being worked out, so a result is
 * never applied to cues it was not computed for.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SubtitleCue } from '@/types';
import { AutoSyncResult, SubtitleAutoSync } from '@/services/SubtitleAutoSync';

interface Options {
    videoPath: string;
    cues: SubtitleCue[];
    isExternal: boolean;
    /** Local files only: a network stream would be fetched twice to analyse it. */
    enabled: boolean;
    currentTimeRef: React.MutableRefObject<number>;
    delayMs: number;
    setDelay: (ms: number) => void;
    showToast: (message: string) => void;
    selectedAudioTrackIndex?: number;
    audioTracksLoaded?: boolean;
}

/** One line for a result, shared by the toast and the sync panel. */
export function describeAutoSync(result: AutoSyncResult): string {
    switch (result.kind) {
        case 'synced': {
            if (Math.abs(result.delayMs) < 100) {return 'Subtitles already in sync';}
            const s = (Math.abs(result.delayMs) / 1000).toFixed(2);
            return `Subtitles moved ${s} s ${result.delayMs > 0 ? 'later' : 'earlier'}`;
        }
        case 'drift': return 'Couldn’t auto sync: this subtitle is for a different frame rate. Try another one.';
        case 'unsure': return 'Couldn’t auto sync: the dialogue isn’t clear enough here. Try Pick a line.';
        case 'too-few-cues': return 'Couldn’t auto sync: not enough dialogue nearby. Try again during a conversation.';
        case 'no-audio': return 'Couldn’t auto sync: this video’s audio can’t be read.';
        case 'failed': return 'Auto sync failed. Try again, or use Pick a line.';
    }
}

export function useSubtitleAutoSync({
    videoPath, cues, isExternal, enabled, currentTimeRef, delayMs, setDelay, showToast,
    selectedAudioTrackIndex, audioTracksLoaded,
}: Options) {
    const [running, setRunning] = useState(false);
    const runningRef = useRef(false);
    const cuesRef = useRef(cues);
    cuesRef.current = cues;
    const delayRef = useRef(delayMs);
    delayRef.current = delayMs;
    const audioTrackRef = useRef(selectedAudioTrackIndex);
    audioTrackRef.current = selectedAudioTrackIndex;

    const run = useCallback(async (manual: boolean): Promise<AutoSyncResult | null> => {
        if (runningRef.current || !enabled || cues.length === 0) {return null;}
        runningRef.current = true;
        setRunning(true);
        const analysed = cues;
        try {
            const trackIndex = audioTrackRef.current ?? -1;
            const result = await SubtitleAutoSync.compute(videoPath, analysed, currentTimeRef.current, trackIndex);
            if (cuesRef.current !== analysed) {return null;}   // subtitle changed meanwhile
            // An automatic answer yields to anything the user set while it ran.
            if (!manual && delayRef.current !== 0) {return null;}
            if (result.kind === 'synced') {setDelay(result.delayMs);}
            // A manual run reports in the sync panel; an automatic one has only the toast, and
            // says it was automatic, since nobody asked for it.
            if (!manual) {
                const message = describeAutoSync(result);
                showToast(result.kind === 'synced' ? `Auto sync: ${message}` : message);
            }
            return result;
        } finally {
            runningRef.current = false;
            setRunning(false);
        }
    }, [enabled, cues, videoPath, currentTimeRef, setDelay, showToast]);

    const attempted = useRef<SubtitleCue[] | null>(null);
    useEffect(() => {
        if (!enabled || !isExternal || cues.length === 0 || delayMs !== 0) {return;}
        if (audioTracksLoaded === false) {return;}
        if (attempted.current === cues) {return;}
        attempted.current = cues;
        run(false);
    }, [enabled, isExternal, cues, delayMs, audioTracksLoaded, run]);

    return { runAutoSync: () => run(true), autoSyncRunning: running };
}
