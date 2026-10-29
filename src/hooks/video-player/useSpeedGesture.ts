/**
 * useSpeedGesture Hook - FIXED
 *
 * Fixed: Speed gesture now properly maintains rate until user releases
 * by passing isGestureActive flag to prevent HUD auto-hide
 */

import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { SharedValue, runOnJS } from 'react-native-reanimated';
import { PLAYER_CONSTANTS } from './types';

// ============================================================================
// TYPES
// ============================================================================

interface UseSpeedGestureOptions {
    screenWidth: number;
    isLockedShared: SharedValue<boolean>;
    speedBase: SharedValue<number>;
    speedGestureActive: SharedValue<boolean>;
    lastSpeedUpdate: SharedValue<number>;

    // ✅ UPDATED: Now accepts isGestureActive flag
    onSpeedChange: (rate: number, isGestureActive?: boolean) => void;
    onSpeedReset: () => void;
    onGestureStart?: () => void;
    onLockTap: () => void;
}

// ============================================================================
// HOOK
// ============================================================================

export function useSpeedGesture(options: UseSpeedGestureOptions) {
    const {
        screenWidth,
        isLockedShared,
        speedBase,
        speedGestureActive,
        lastSpeedUpdate,
        onSpeedChange,
        onSpeedReset,
        onGestureStart,
        onLockTap,
    } = options;

    // Right side - starts at 2x (fast forward mode)
    const rightGesture = useMemo(() => {
        return Gesture.Pan()
            .activateAfterLongPress(500)
            .hitSlop({
                left: -(screenWidth / 2),
                right: 0,
                top: 0,
                bottom: 0,
            })
            .onStart(() => {
                'worklet';

                if (isLockedShared.value) {
                    runOnJS(onLockTap)();
                    return;
                }

                speedGestureActive.value = true;
                speedBase.value = 2.0;
                lastSpeedUpdate.value = 2.0;

                // ✅ FIX: Pass true to indicate active gesture
                runOnJS(onSpeedChange)(2.0, true);

                // Hide controls
                if (onGestureStart) {runOnJS(onGestureStart)();}
            })
            .onUpdate((event) => {
                'worklet';

                if (!speedGestureActive.value || isLockedShared.value) {return;}

                const speedDelta = event.translationX * PLAYER_CONSTANTS.SPEED_SENSITIVITY;
                let rawSpeed = speedBase.value + speedDelta;

                const newSpeed = Math.max(0.25, Math.min(4.0, Math.round(rawSpeed * 4) / 4));

                if (Math.abs(newSpeed - lastSpeedUpdate.value) > 0.05) {
                    lastSpeedUpdate.value = newSpeed;
                    // ✅ FIX: Keep passing true during gesture
                    runOnJS(onSpeedChange)(newSpeed, true);
                }
            })
            .onEnd(() => {
                'worklet';

                if (!speedGestureActive.value) {return;}

                speedGestureActive.value = false;
                // ✅ FIX: Now properly resets when gesture ends
                runOnJS(onSpeedReset)();
            })
            .onFinalize(() => {
                'worklet';

                if (!speedGestureActive.value) {return;}

                speedGestureActive.value = false;
                runOnJS(onSpeedReset)();
            });
    }, [
        screenWidth,
        isLockedShared,
        speedBase,
        speedGestureActive,
        lastSpeedUpdate,
        onSpeedChange,
        onSpeedReset,
        onLockTap,
    ]);

    // Left side - starts at 0.5x (slow motion mode)
    const leftGesture = useMemo(() => {
        return Gesture.Pan()
            .activateAfterLongPress(500)
            .hitSlop({
                left: 0,
                right: -(screenWidth / 2),
                top: 0,
                bottom: 0,
            })
            .onStart(() => {
                'worklet';

                if (isLockedShared.value) {
                    runOnJS(onLockTap)();
                    return;
                }

                speedGestureActive.value = true;
                speedBase.value = 0.5;
                lastSpeedUpdate.value = 0.5;

                // ✅ FIX: Pass true to indicate active gesture
                runOnJS(onSpeedChange)(0.5, true);

                // Hide controls
                if (onGestureStart) {runOnJS(onGestureStart)();}
            })
            .onUpdate((event) => {
                'worklet';

                if (!speedGestureActive.value || isLockedShared.value) {return;}

                const speedDelta = event.translationX * PLAYER_CONSTANTS.SPEED_SENSITIVITY;
                let rawSpeed = speedBase.value + speedDelta;

                const newSpeed = Math.max(0.25, Math.min(4.0, Math.round(rawSpeed * 4) / 4));

                if (Math.abs(newSpeed - lastSpeedUpdate.value) > 0.05) {
                    lastSpeedUpdate.value = newSpeed;
                    // ✅ FIX: Keep passing true during gesture
                    runOnJS(onSpeedChange)(newSpeed, true);
                }
            })
            .onEnd(() => {
                'worklet';

                if (!speedGestureActive.value) {return;}

                speedGestureActive.value = false;
                runOnJS(onSpeedReset)();
            })
            .onFinalize(() => {
                'worklet';

                if (!speedGestureActive.value) {return;}

                speedGestureActive.value = false;
                runOnJS(onSpeedReset)();
            });
    }, [
        screenWidth,
        isLockedShared,
        speedBase,
        speedGestureActive,
        lastSpeedUpdate,
        onSpeedChange,
        onSpeedReset,
        onLockTap,
    ]);

    return { rightGesture, leftGesture };
}
