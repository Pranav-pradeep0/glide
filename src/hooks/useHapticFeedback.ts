import { MutableRefObject, useCallback, useEffect, useRef } from 'react';
import { SubtitleCue } from '../types';
import { HapticEngineService } from '../services/HapticEngineService';
import { HapticPatternGenerator } from '../services/HapticPatternGenerator';
import { SubtitleParser } from '../utils/SubtitleParser';
import { useSubtitleCueStore } from '../store/subtitleCueStore';

export interface UseHapticFeedbackProps {
    enabled: boolean;
    currentTimeRef: MutableRefObject<number>;
    subtitleCues?: SubtitleCue[];
    hapticCues?: SubtitleCue[];
    isPlaying: boolean;
    subtitleDelay?: number; // in milliseconds
    /** Playback rate, so interpolation between position events tracks the real clock. */
    playbackRate?: number;
    onSubtitleCueChange?: (cue: SubtitleCue | null) => void;
}

/**
 * Unified sync hook for subtitles and haptic feedback.
 *
 * Consolidates the subtitle cue display polling and haptic cue polling
 * into a single unified timer on the JS thread during video playback.
 */
export function useHapticFeedback({
    enabled,
    currentTimeRef,
    subtitleCues = [],
    hapticCues,
    isPlaying,
    subtitleDelay = 0,
    playbackRate = 1,
    onSubtitleCueChange,
}: UseHapticFeedbackProps) {
    const lastProcessedCueIndex = useRef<number>(-1);
    const lastEffectiveTimeRef = useRef<number>(0);
    const cueCursorRef = useRef<number>(0);
    const lastDisplayCueRef = useRef<SubtitleCue | null>(null);
    const engine = HapticEngineService.getInstance();

    // currentTimeRef only moves when a native progress event lands, every 250 ms. Reading
    // it straight was up to a whole event late on top of this timer's own interval -- half
    // a second of drift on a subtitle, and far too much for a haptic meant to land on a
    // door slam. Wall-clock since the last event closes the gap.
    const lastEventTimeRef = useRef(0);
    const lastEventAtRef = useRef(0);
    const readTime = useCallback((playing: boolean, rate: number) => {
        const reported = currentTimeRef.current;
        if (reported !== lastEventTimeRef.current) {
            lastEventTimeRef.current = reported;
            lastEventAtRef.current = Date.now();
        }
        if (!playing) {return reported;}
        const elapsed = (Date.now() - lastEventAtRef.current) / 1000;
        return reported + elapsed * rate;
    }, [currentTimeRef]);

    // Determine cues to use for haptics (WYSIWYG: display cues take priority, fallback to haptic cues)
    const effectiveHapticCues = subtitleCues.length > 0 ? subtitleCues : (hapticCues || []);
    const hasSubtitles = subtitleCues.length > 0;
    const hasHaptics = enabled && effectiveHapticCues.length > 0;

    // Enable/Disable engine
    useEffect(() => {
        engine.setEnabled(enabled);
    }, [enabled, engine]);

    // Single unified interval for subtitle display and haptic feedback
    useEffect(() => {
        if (!hasSubtitles && (!hasHaptics || !isPlaying)) {
            // Nothing to sync
            if (lastDisplayCueRef.current !== null) {
                lastDisplayCueRef.current = null;
                if (onSubtitleCueChange) {
                    onSubtitleCueChange(null);
                } else {
                    useSubtitleCueStore.getState().clearCue();
                }
            }
            return;
        }

        const findNextCue = (effectiveTime: number): SubtitleCue | null => {
            let cursor = cueCursorRef.current;

            if (
                cursor >= effectiveHapticCues.length ||
                (cursor > 0 && effectiveTime < effectiveHapticCues[cursor - 1].startTime)
            ) {
                cursor = lowerBoundCue(effectiveHapticCues, effectiveTime);
            }

            while (
                cursor < effectiveHapticCues.length &&
                effectiveTime > effectiveHapticCues[cursor].startTime + 0.5
            ) {
                cursor++;
            }

            cueCursorRef.current = cursor;

            for (let i = Math.max(0, cursor - 1); i < Math.min(effectiveHapticCues.length, cursor + 3); i++) {
                const cue = effectiveHapticCues[i];
                if (effectiveTime >= cue.startTime && effectiveTime <= cue.startTime + 0.5) {
                    return cue;
                }
            }

            return null;
        };

        // 125 ms while haptics are live, for tactile timing; 250 ms for subtitles alone.
        // Paused, nothing moves except a seek, so 500 ms is enough to pick that up and the
        // timer stops being a wakeup four times a second for an unchanging number.
        const intervalMs = !isPlaying ? 500 : (hasHaptics ? 125 : 250);

        const intervalId = setInterval(() => {
            const effectiveTime = readTime(isPlaying, playbackRate) - (subtitleDelay / 1000);

            // 1. Subtitle display synchronization
            if (hasSubtitles) {
                const activeCue = SubtitleParser.findActiveCue(subtitleCues, effectiveTime);
                const prev = lastDisplayCueRef.current;

                if (
                    (prev === null && activeCue !== null) ||
                    (prev !== null && activeCue === null) ||
                    (prev && activeCue && (prev.text !== activeCue.text || prev.startTime !== activeCue.startTime))
                ) {
                    lastDisplayCueRef.current = activeCue;
                    if (onSubtitleCueChange) {
                        onSubtitleCueChange(activeCue);
                    } else {
                        useSubtitleCueStore.getState().setCurrentCue(activeCue);
                    }
                }
            }

            // 2. Haptic feedback synchronization
            if (hasHaptics && isPlaying) {
                if (Math.abs(effectiveTime - lastEffectiveTimeRef.current) > 2) {
                    cueCursorRef.current = lowerBoundCue(effectiveHapticCues, effectiveTime);
                    lastProcessedCueIndex.current = -1;
                }
                lastEffectiveTimeRef.current = effectiveTime;

                const activeCue = findNextCue(effectiveTime);

                if (!activeCue || lastProcessedCueIndex.current === activeCue.index) {
                    return;
                }

                const pattern = HapticPatternGenerator.generateFromCue(activeCue);
                lastProcessedCueIndex.current = activeCue.index;

                if (!pattern) {
                    return;
                }

                if (__DEV__) {
                    console.log(`[Haptic] Triggering: ${pattern.soundEffect} (${pattern.category})`);
                }
                engine.triggerHaptic(pattern);
            }
        }, intervalMs);

        return () => clearInterval(intervalId);
    }, [
        currentTimeRef,
        effectiveHapticCues,
        enabled,
        engine,
        hasHaptics,
        hasSubtitles,
        isPlaying,
        onSubtitleCueChange,
        playbackRate,
        readTime,
        subtitleCues,
        subtitleDelay,
    ]);

    useEffect(() => {
        cueCursorRef.current = 0;
        lastEffectiveTimeRef.current = 0;
        lastProcessedCueIndex.current = -1;
        lastDisplayCueRef.current = null;
        if (subtitleCues.length === 0) {
            if (onSubtitleCueChange) {
                onSubtitleCueChange(null);
            } else {
                useSubtitleCueStore.getState().clearCue();
            }
        }
    }, [subtitleCues, effectiveHapticCues, onSubtitleCueChange]);

    // Debug: Log all detected haptics when cues load
    useEffect(() => {
        if (effectiveHapticCues.length > 0) {
            HapticPatternGenerator.debugScanAllCues(effectiveHapticCues);
        }
    }, [effectiveHapticCues]);

    // Cleanup cue on unmount
    useEffect(() => {
        return () => {
            if (onSubtitleCueChange) {
                onSubtitleCueChange(null);
            } else {
                useSubtitleCueStore.getState().clearCue();
            }
        };
    }, [onSubtitleCueChange]);

    return {};
}

function lowerBoundCue(cues: SubtitleCue[], time: number): number {
    let left = 0;
    let right = cues.length;

    while (left < right) {
        const mid = Math.floor((left + right) / 2);
        if (cues[mid].startTime < time) {
            left = mid + 1;
        } else {
            right = mid;
        }
    }

    return left;
}
