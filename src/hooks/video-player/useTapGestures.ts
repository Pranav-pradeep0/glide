/**
 * useTapGestures Hook
 *
 * - Single tap: toggle controls (or continue a double-tap seek run, see usePlayerGestures)
 * - Double tap: seek on the outer 40% each side, play/pause in the middle (zones in usePlayerGestures)
 */

import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { SharedValue, runOnJS, useSharedValue } from 'react-native-reanimated';

interface UseTapGesturesOptions {
    isLockedShared: SharedValue<boolean>;
    /** Where the tap landed and when the finger went down (a single tap reports late: it waits out the double tap). */
    onSingleTap: (x: number, y: number, tapAt: number) => void;
    onDoubleTap: (x: number, y: number) => void;
    onLockTap: () => void;
}

/** Double taps take priority over single taps. */
export function useTapGestures(options: UseTapGesturesOptions) {
    const { isLockedShared, onSingleTap, onDoubleTap, onLockTap } = options;
    const tapStartedAt = useSharedValue(0);

    return useMemo(() => {
        // A single tap waits for this to fail, so maxDelay is the single-tap latency.
        const doubleTap = Gesture.Tap()
            .numberOfTaps(2)
            .maxDelay(250)
            .maxDuration(300)
            .onEnd((event) => {
                'worklet';
                if (isLockedShared.value) {
                    runOnJS(onLockTap)();
                    return;
                }
                runOnJS(onDoubleTap)(event.absoluteX, event.absoluteY);
            });

        // Locked taps go through onSingleTap too: they show the unlock chip.
        const singleTap = Gesture.Tap()
            .numberOfTaps(1)
            .maxDuration(300)
            .onBegin(() => {
                'worklet';
                tapStartedAt.value = Date.now();
            })
            .onEnd((event) => {
                'worklet';
                runOnJS(onSingleTap)(event.absoluteX, event.absoluteY, tapStartedAt.value);
            });

        return Gesture.Exclusive(doubleTap, singleTap);
    }, [isLockedShared, onSingleTap, onDoubleTap, onLockTap, tapStartedAt]);
}
