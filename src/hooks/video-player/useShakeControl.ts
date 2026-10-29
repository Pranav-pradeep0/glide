/**
 * useShakeControl Hook
 *
 * Uses Reanimated sensor values to detect a shake gesture.
 * Runs fully on the UI thread and forwards the event to JS via runOnJS.
 */

import { useMemo } from 'react';
import { useAnimatedSensor, SensorType, useDerivedValue, runOnJS, useSharedValue } from 'react-native-reanimated';

export type ShakeAction =
    | 'play_pause'
    | 'next'
    | 'previous'
    | 'seek_forward'
    | 'seek_backward';

interface UseShakeControlOptions {
    enabled: boolean;
    onShake: () => void;
    onThresholdHit?: () => void;
    mode?: 'active' | 'tuning';
    shakeThreshold?: number;
    cooldownMs?: number;
    isLocked?: boolean;
    isSeeking?: boolean;
    isInPip?: boolean;
    isQuickSettingsOpen?: boolean;
}

const DEFAULT_SHAKE_THRESHOLD = 2.2; // In g units (approx)
const DEFAULT_COOLDOWN_MS = 900;
const GRAVITY = 9.81;

export function useShakeControl(options: UseShakeControlOptions) {
    const {
        enabled,
        onShake,
        onThresholdHit,
        mode = 'active',
        shakeThreshold = DEFAULT_SHAKE_THRESHOLD,
        cooldownMs = DEFAULT_COOLDOWN_MS,
        isLocked = false,
        isSeeking = false,
        isInPip = false,
        isQuickSettingsOpen = false,
    } = options;

    const lastShakeAt = useSharedValue(0);

    const sensor = useAnimatedSensor(SensorType.ACCELEROMETER, {
        interval: 100,
    });

    const isActive = useMemo(() => {
        return enabled && !isLocked && !isSeeking && !isInPip && !isQuickSettingsOpen;
    }, [enabled, isLocked, isSeeking, isInPip, isQuickSettingsOpen]);

    useDerivedValue(() => {
        'worklet';
        if (!isActive) { return; }

        const { x, y, z } = sensor.sensor.value;
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        const gMagnitude = magnitude / GRAVITY;
        const now = Date.now();

        if (gMagnitude >= shakeThreshold && now - lastShakeAt.value > cooldownMs) {
            lastShakeAt.value = now;
            if (mode === 'tuning') {
                if (onThresholdHit) {
                    runOnJS(onThresholdHit)();
                }
            } else {
                runOnJS(onShake)();
            }
        }
    });
}

/**
 * The hook as a component, so the accelerometer only exists while it is mounted:
 * `useAnimatedSensor` registers the sensor for the caller's whole lifetime regardless of
 * `enabled`. Render it as `{enabled && <ShakeDetector ... />}`.
 */
export function ShakeDetector(props: Omit<UseShakeControlOptions, 'enabled'>) {
    useShakeControl({ ...props, enabled: true });
    return null;
}
