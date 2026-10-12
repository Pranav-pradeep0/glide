import { MutableRefObject, useCallback, useEffect, useRef } from 'react';
import { SubtitleCue } from '../types';
import { SubtitleParser } from '../utils/SubtitleParser';
import { useSubtitleCueStore } from '../store/subtitleCueStore';

/** Position events arrive every 250 ms; allow a little jitter on top. */
const MAX_EXTRAPOLATION_S = 0.3;

export interface UseSubtitleDisplayProps {
    currentTimeRef: MutableRefObject<number>;
    subtitleCues?: SubtitleCue[];
    isPlaying: boolean;
    subtitleDelay?: number; // in milliseconds
    /** Playback rate, so interpolation between position events tracks the real clock. */
    playbackRate?: number;
    onSubtitleCueChange?: (cue: SubtitleCue | null) => void;
}

/** Shows the subtitle cue for the current position. Haptics are timed natively (HapticPerformer). */
export function useSubtitleDisplay({
    currentTimeRef,
    subtitleCues = [],
    isPlaying,
    subtitleDelay = 0,
    playbackRate = 1,
    onSubtitleCueChange,
}: UseSubtitleDisplayProps) {
    const lastDisplayCueRef = useRef<SubtitleCue | null>(null);

    // currentTimeRef only moves when a native progress event lands, every 250 ms. Reading
    // it straight was up to a whole event late on top of this timer's own interval, half
    // a second of drift on a subtitle. Wall-clock since the last event closes the gap.
    //
    // Capped at a little over one event interval. Past that, no event means the video is
    // not advancing -- buffering, or just resumed with the last event still from before
    // the pause -- and extrapolating further would run subtitles ahead of the picture.
    const lastEventTimeRef = useRef(0);
    const lastEventAtRef = useRef(0);
    const readTime = useCallback((playing: boolean, rate: number) => {
        const reported = currentTimeRef.current;
        if (reported !== lastEventTimeRef.current) {
            lastEventTimeRef.current = reported;
            lastEventAtRef.current = Date.now();
        }
        if (!playing) {return reported;}
        const elapsed = Math.min((Date.now() - lastEventAtRef.current) / 1000, MAX_EXTRAPOLATION_S);
        return reported + elapsed * rate;
    }, [currentTimeRef]);

    const setCue = useCallback((cue: SubtitleCue | null) => {
        if (onSubtitleCueChange) {
            onSubtitleCueChange(cue);
        } else if (cue) {
            useSubtitleCueStore.getState().setCurrentCue(cue);
        } else {
            useSubtitleCueStore.getState().clearCue();
        }
    }, [onSubtitleCueChange]);

    useEffect(() => {
        if (subtitleCues.length === 0) {
            if (lastDisplayCueRef.current !== null) {
                lastDisplayCueRef.current = null;
                setCue(null);
            }
            return;
        }

        // Play state just changed (or the cues did): the last event's timestamp is from
        // before it, so count from now rather than from then.
        lastEventTimeRef.current = currentTimeRef.current;
        lastEventAtRef.current = Date.now();

        // Paused, nothing moves except a seek, so 500 ms is enough to pick that up and the
        // timer stops being a wakeup four times a second for an unchanging number.
        const intervalId = setInterval(() => {
            const effectiveTime = readTime(isPlaying, playbackRate) - (subtitleDelay / 1000);
            const activeCue = SubtitleParser.findActiveCue(subtitleCues, effectiveTime);
            const prev = lastDisplayCueRef.current;
            if (
                (prev === null && activeCue !== null) ||
                (prev !== null && activeCue === null) ||
                (prev && activeCue && (prev.text !== activeCue.text || prev.startTime !== activeCue.startTime))
            ) {
                lastDisplayCueRef.current = activeCue;
                setCue(activeCue);
            }
        }, isPlaying ? 250 : 500);

        return () => clearInterval(intervalId);
    }, [currentTimeRef, isPlaying, playbackRate, readTime, setCue, subtitleCues, subtitleDelay]);

    useEffect(() => {
        lastDisplayCueRef.current = null;
        if (subtitleCues.length === 0) {setCue(null);}
    }, [subtitleCues, setCue]);

    // Cleanup cue on unmount
    useEffect(() => () => setCue(null), [setCue]);
}
