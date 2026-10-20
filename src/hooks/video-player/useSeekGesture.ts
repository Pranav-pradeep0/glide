/**
 * useSeekGesture Hook
 *
 * CRITICAL: This hook is prone to breaking during refactoring.
 * Handle with extreme care. The seek gesture is essential for user experience.
 *
 * Implements horizontal pan gesture for seeking through video.
 * Uses worklet-based updates for 60fps performance.
 */

import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { SharedValue, runOnJS, useSharedValue } from 'react-native-reanimated';
import { PLAYER_CONSTANTS } from './types';

// ============================================================================
// TYPES
// ============================================================================

interface UseSeekGestureOptions {
    // Shared values
    currentTimeShared: SharedValue<number>;
    durationShared: SharedValue<number>;
    isLockedShared: SharedValue<boolean>;

    // Gesture state
    seekStartTime: SharedValue<number>;
    seekOffset: SharedValue<number>;
    gestureActive: SharedValue<boolean>;

    // Output shared value for HUD
    seekTimeShared: SharedValue<number>;

    // Callbacks (JS thread)
    onSeekStart: () => void;
    onSeekUpdate: (time: number) => void;
    onSeekComplete: (time: number) => void;
    onLockTap: () => void;

    /** The system Back gesture's left/right edge strips in dp: a swipe starting there is Back. */
    backEdges: { left: number; right: number };
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Creates a horizontal pan gesture for seeking.
 *
 * Gesture flow:
 * 1. onStart: Capture current time, set seeking state
 * 2. onUpdate: Calculate new time based on translation, update HUD
 * 3. onEnd: Apply final seek position
 *
 * IMPORTANT: Uses worklet for calculations, runOnJS for state updates.
 * This ensures smooth 60fps during the gesture while keeping React state in sync.
 */
export function useSeekGesture(options: UseSeekGestureOptions) {
    const {
        currentTimeShared,
        durationShared,
        isLockedShared,
        seekStartTime,
        seekOffset,
        gestureActive,
        seekTimeShared,
        onSeekStart,
        onSeekUpdate,
        onSeekComplete,
        onLockTap,
        backEdges,
    } = options;
    const lastSeekJsDispatchAt = useSharedValue(0);

    const gesture = useMemo(() => {
        return Gesture.Pan()
            // Only allow 1 finger for seeking to avoid conflict with zoom
            .maxPointers(1)
            // Only activate on clear horizontal movement
            .activeOffsetX([-15, 15])
            // Fail if user swipes vertically
            .failOffsetY([-15, 15])
            // Not from the edge strips: the system takes that swipe as Back and cancels this
            // gesture, and a cancelled seek still commits, so the video jumped on the way out.
            .hitSlop({ left: -backEdges.left, right: -backEdges.right })
            .onStart(() => {
                'worklet';

                // Don't allow seeking when locked
                if (isLockedShared.value) {
                    runOnJS(onLockTap)();
                    return;
                }

                // Mark gesture as active
                gestureActive.value = true;

                // Capture starting time
                seekStartTime.value = currentTimeShared.value;
                seekOffset.value = 0;
                seekTimeShared.value = currentTimeShared.value;

                // Notify JS thread that seeking started
                runOnJS(onSeekStart)();
            })
            .onUpdate((event) => {
                'worklet';

                // Skip if gesture isn't properly started (e.g. if locked)
                if (!gestureActive.value) {return;}

                // Calculate offset based on horizontal translation
                // Sensitivity controls how much screen movement = time change
                seekOffset.value = event.translationX * PLAYER_CONSTANTS.SEEK_SENSITIVITY;

                // Calculate target time (clamped to valid range)
                const targetTime = Math.max(
                    0,
                    Math.min(
                        durationShared.value || 0,
                        seekStartTime.value + seekOffset.value
                    )
                );

                // Update shared value for 60fps HUD
                seekTimeShared.value = targetTime;
                const now = Date.now();
                if (now - lastSeekJsDispatchAt.value >= 33) {
                    lastSeekJsDispatchAt.value = now;
                    runOnJS(onSeekUpdate)(targetTime);
                }
            })
            .onEnd(() => {
                'worklet';

                // Skip if gesture wasn't properly started
                if (!gestureActive.value) {return;}

                // Calculate final time
                const finalTime = Math.max(
                    0,
                    Math.min(
                        durationShared.value || 0,
                        seekStartTime.value + seekOffset.value
                    )
                );

                // Apply seek and notify JS thread
                runOnJS(onSeekComplete)(finalTime);

                // Reset gesture state
                gestureActive.value = false;
            })
            .onFinalize(() => {
                'worklet';

                // If cancelled before onEnd, finalize still needs to complete seek/reset state.
                if (gestureActive.value) {
                    const finalTime = Math.max(
                        0,
                        Math.min(durationShared.value || 0, seekTimeShared.value)
                    );
                    runOnJS(onSeekComplete)(finalTime);
                }

                // Ensure gesture state is reset in all paths.
                gestureActive.value = false;
            });
    }, [
        currentTimeShared,
        durationShared,
        isLockedShared,
        seekStartTime,
        seekOffset,
        gestureActive,
        seekTimeShared,
        lastSeekJsDispatchAt,
        onSeekStart,
        onSeekUpdate,
        onSeekComplete,
        onLockTap,
        backEdges,
    ]);

    return gesture;
}

export default useSeekGesture;
