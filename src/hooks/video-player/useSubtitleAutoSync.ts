/**
 * Runs SubtitleAutoSync and applies its answer all-or-nothing.
 *
 * - Automatic: once per external subtitle, and only while the sync is untouched (0, ratio 1). An
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
    /** Frame-rate retiming, applied with the delay: a cue at c is shown at c * ratio + delay. */
    ratio: number;
    setDelay: (ms: number) => void;
    setRatio: (ratio: number) => void;
    showToast: (message: string) => void;
    selectedAudioTrackIndex?: number;
    audioTracksLoaded?: boolean;
}

/** One line for a result, shared by the toast and the sync panel. */
export function describeAutoSync(result: AutoSyncResult): string {
    switch (result.kind) {
        case 'synced': {
            const s = (Math.abs(result.delayMs) / 1000).toFixed(2);
            const moved = `${s} s ${result.delayMs > 0 ? 'later' : 'earlier'}`;
            if (result.ratio !== 1) {
                const retimed = 'Subtitles retimed for a different frame rate';
                return Math.abs(result.delayMs) < 100 ? retimed : `${retimed}, moved ${moved}`;
            }
            if (Math.abs(result.delayMs) < 100) {return 'Subtitles already in sync';}
            return `Subtitles moved ${moved}`;
        }
        case 'drift': return 'Couldn’t auto sync: this subtitle is for a different frame rate. Try another one.';
        case 'unsure': return 'Couldn’t auto sync: the dialogue isn’t clear enough here. Try Pick a line.';
        case 'too-few-cues': return 'Couldn’t auto sync: not enough dialogue nearby. Try again during a conversation.';
        case 'no-audio': return 'Couldn’t auto sync: this video’s audio can’t be read.';
        case 'failed': return 'Auto sync failed. Try again, or use Pick a line.';
    }
}

export function useSubtitleAutoSync({
    videoPath, cues, isExternal, enabled, currentTimeRef, delayMs, ratio, setDelay, setRatio, showToast,
    selectedAudioTrackIndex, audioTracksLoaded,
}: Options) {
    const [running, setRunning] = useState(false);
    const runningRef = useRef(false);
    const cuesRef = useRef(cues);
    cuesRef.current = cues;
    // Untouched: no delay and no retiming. Anything else is the user's (or an earlier run's).
    const untouched = delayMs === 0 && ratio === 1;
    const untouchedRef = useRef(untouched);
    untouchedRef.current = untouched;
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
            if (!manual && !untouchedRef.current) {return null;}
            // Delay and ratio together; a plain answer sets any earlier retiming back to 1.
            if (result.kind === 'synced') {
                setDelay(result.delayMs);
                setRatio(result.ratio);
            }
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
    }, [enabled, cues, videoPath, currentTimeRef, setDelay, setRatio, showToast]);

    // A frame-rate ratio belongs to the subtitle it was worked out for: another one starts at 1,
    // else a correctly timed track drifts ~2.5 min an hour and is never "untouched" to auto sync.
    // The first cues keep the ratio saved for this video.
    const ratioRef = useRef(ratio);
    ratioRef.current = ratio;
    const shownCues = useRef<SubtitleCue[] | null>(null);
    useEffect(() => {
        if (cues.length === 0) {return;}
        if (shownCues.current && shownCues.current !== cues && ratioRef.current !== 1) {setRatio(1);}
        shownCues.current = cues;
    }, [cues, setRatio]);

    const attempted = useRef<SubtitleCue[] | null>(null);
    useEffect(() => {
        if (!enabled || !isExternal || cues.length === 0 || !untouched) {return;}
        if (audioTracksLoaded === false) {return;}
        // A run for the previous subtitle is still going; this effect runs again when it ends.
        if (running) {return;}
        if (attempted.current === cues) {return;}
        attempted.current = cues;
        run(false);
    }, [enabled, isExternal, cues, untouched, audioTracksLoaded, running, run]);

    return { runAutoSync: () => run(true), autoSyncRunning: running };
}
