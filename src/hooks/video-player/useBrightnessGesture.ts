/**
 * useBrightnessGesture Hook
 *
 * Implements vertical pan gesture on the LEFT half of the screen to adjust brightness.
 * Swipe up increases, swipe down decreases.
 */

import { useMemo } from 'react';
import { NativeModules } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { SharedValue, runOnJS, useSharedValue } from 'react-native-reanimated';
import { PLAYER_CONSTANTS } from './types';

const { DisplayBrightnessModule: BrightnessModule } = NativeModules;

const applyBrightnessDefault = (value: number) => {
    BrightnessModule?.setBrightness?.(value);
};

// ============================================================================
// TYPES
// ============================================================================

interface UseBrightnessGestureOptions {
    // Screen dimensions for hit slop calculation
    screenWidth: number;
    leftZoneWidth: number;

    // Shared values
    isLockedShared: SharedValue<boolean>;
    currentBrightness: SharedValue<number>;
    brightnessStart: SharedValue<number>;

    onBrightnessChange: (value: number) => void;
    onBrightnessApply?: (value: number, isFinal?: boolean) => void;
    onBrightnessWait?: () => void;
    onGestureStart: () => void;
    onGestureEnd: () => void;
    onLockTap: () => void;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Creates a vertical pan gesture for brightness control.
 * Active on the left half, minus the system-gesture strips at the top and bottom.
 */
export function useBrightnessGesture(options: UseBrightnessGestureOptions) {
    const {
        screenWidth,
        leftZoneWidth,
        isLockedShared,
        currentBrightness,
        brightnessStart,
        onBrightnessChange,
        onBrightnessApply,
        onGestureEnd,
        onGestureStart,
        onLockTap,
    } = options;

    const isGestureActive = useSharedValue(false);
    const lastAppliedPercent = useSharedValue(-1);
    const effectiveBrightnessApply = onBrightnessApply || applyBrightnessDefault;

    const gesture = useMemo(() => {
        return Gesture.Pan()
            // Only allow 1 finger
            .maxPointers(1)
            // Only activate on clear vertical movement (strict to avoid Double Tap conflict)
            .activeOffsetY([-25, 25])
            // Fail if horizontal swipe
            .failOffsetX([-15, 15])
            // Left half; the top/bottom strips belong to the notification shade and home gesture.
            .hitSlop({
                left: 0,
                right: -(screenWidth - leftZoneWidth),
                top: -PLAYER_CONSTANTS.SYSTEM_EDGE_DP,
                bottom: -PLAYER_CONSTANTS.SYSTEM_EDGE_DP,
            })
            .onStart((event) => {
                'worklet';

                if (isLockedShared.value) {
                    runOnJS(onLockTap)();
                    return;
                }

                if (event.x > leftZoneWidth) {
                    return;
                }

                isGestureActive.value = true;

                // Capture starting brightness
                brightnessStart.value = currentBrightness.value;
                lastAppliedPercent.value = Math.round(currentBrightness.value * 100);

                // Show HUD immediately (still need to notify JS to show the component)
                runOnJS(onBrightnessChange)(currentBrightness.value);

                // Hide controls
                runOnJS(onGestureStart)();
            })
            .onUpdate((event) => {
                'worklet';

                if (isLockedShared.value || !isGestureActive.value) {return;}

                // Calculate delta - negative Y translation = up = increase
                const delta = -event.translationY * PLAYER_CONSTANTS.BRIGHTNESS_SENSITIVITY;
                const newValue = Math.max(0, Math.min(1, brightnessStart.value + delta));

                // Update shared value (HUD will read this directly)
                currentBrightness.value = newValue;

                // Send each 1% step once: no call while the finger holds still, and a fast
                // swipe no longer skips the frames that miss a 5 px row.
                const percent = Math.round(newValue * 100);
                if (percent !== lastAppliedPercent.value) {
                    lastAppliedPercent.value = percent;
                    runOnJS(effectiveBrightnessApply)(newValue);
                }
            })
            .onEnd(() => {
                'worklet';
                if (!isGestureActive.value) {return;}
                runOnJS(effectiveBrightnessApply)(currentBrightness.value, true);
            })
            .onFinalize(() => {
                'worklet';
                if (isGestureActive.value) {
                    if (!isLockedShared.value) {
                        runOnJS(onGestureEnd)();
                    }
                    isGestureActive.value = false;
                }
            });
        // No onEnd needed -> onEnd added now for persistence
    }, [
        screenWidth,
        leftZoneWidth,
        isLockedShared,
        currentBrightness,
        brightnessStart,
        isGestureActive,
        lastAppliedPercent,
        onBrightnessChange,
        effectiveBrightnessApply,
        onGestureStart,
        onGestureEnd,
        onLockTap,
    ]);

    return gesture;
}

export default useBrightnessGesture;
