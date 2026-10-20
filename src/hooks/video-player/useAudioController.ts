import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { NativeModules, DeviceEventEmitter, EmitterSubscription } from 'react-native';
import { SharedValue, useSharedValue } from 'react-native-reanimated';
import type { GlidePlayerRef } from '@/components/VideoPlayer/GlidePlayer';

const { AudioVolumeModule: AudioModule } = NativeModules;

export type AudioRouteType = 'speaker' | 'bluetooth' | 'wired' | 'usb' | 'unknown';

interface AudioRoute {
    type: AudioRouteType;
    maxVolume: number; // 100 for speaker, 200 for external
}

interface UseAudioControllerReturn {
    // Current volume (0-200 range)
    volume: number;

    // Limits
    maxVolume: number; // 1.0 or 2.0 (normalized)

    // Current audio route
    audioRoute: AudioRoute;

    // Shared value for gesture integration (0-2 range for UI/Gestures)
    currentVolumeShared: SharedValue<number>;

    // Apply volume (normalized 0-2)
    applyVolume: (normalizedValue: number, fromGesture?: boolean) => void;

    // Set volume manually (0-200)
    setVolume: (value: number) => void;

    // Notify gesture ended (syncs React state)
    onGestureEnd: () => void;
}

/**
 * Audio Controller Hook
 *
 * Uses the AudioVolumeModule native module for:
 * - System volume control (0-100%)
 * - Audio route detection
 * - Hardware button listening
 * and the player's own boost (100-200%, LoudnessEnhancer) on top of a maxed system stream.
 *
 * Android keeps a separate stream volume per output device and switches between them
 * itself. This hook never remembers a level per route: on a route change it adopts the new
 * device's own volume and drops any boost, so unplugging headphones at 150% returns the
 * speaker to wherever the user left it rather than to a level carried over from headphones.
 */
export function useAudioController(
    playerRef: React.RefObject<GlidePlayerRef | null>,
    initialVolume: number = 100,
    onHardwareVolumeChange?: (volume: number) => void,
    /** The previous episode's 101-200% boost, kept only while it is still allowed here. */
    carriedBoost?: number,
): UseAudioControllerReturn {
    const [audioRoute, setAudioRoute] = useState<AudioRoute>({
        type: 'speaker',
        maxVolume: 100,
    });

    const [volume, setVolumeState] = useState(initialVolume);

    // Shared value for Reanimated (gestures) - normalized 0-2 (0-200%)
    const currentVolumeShared = useSharedValue(initialVolume / 100);

    // Guard to track if gesture is active (prevents hardware events during swipes)
    const isGestureActiveRef = useRef(false);
    // Lifts the guard shortly after a gesture ends; a new gesture must cancel it.
    const gestureGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (gestureGuardTimerRef.current) { clearTimeout(gestureGuardTimerRef.current); }
    }, []);

    // Track the last volume we set to ignore quantized feedback from system
    // System volume has discrete steps, so 56% might become 53% - we should ignore this
    const lastSetVolumeRef = useRef(initialVolume);
    const lastSetTimeRef = useRef(0);

    // Last boost sent to the player, to avoid redundant native calls
    const lastBoostRef = useRef(100);
    const audioRouteRef = useRef(audioRoute);
    audioRouteRef.current = audioRoute;
    const onHardwareVolumeChangeRef = useRef(onHardwareVolumeChange);
    onHardwareVolumeChangeRef.current = onHardwareVolumeChange;

    const setBoost = useCallback((percent: number) => {
        if (percent === lastBoostRef.current) { return; }
        lastBoostRef.current = percent;
        playerRef.current?.setVolume(percent);
    }, [playerRef]);

    /** Adopt a system-reported level (0-100) as the whole volume, with no boost. */
    const adoptSystemVolume = useCallback((percentage: number) => {
        currentVolumeShared.value = percentage / 100;
        setVolumeState(percentage);
        lastSetVolumeRef.current = percentage;
        lastSetTimeRef.current = Date.now();
        setBoost(100);
    }, [currentVolumeShared, setBoost]);

    // Initialize and start listening
    useEffect(() => {
        if (!AudioModule) {
            if (__DEV__) {console.warn('[AudioController] AudioVolumeModule not available');}
            return;
        }

        Promise.all([AudioModule.getCurrentRoute(), AudioModule.getVolume()]).then(([route, current]: any[]) => {
            setAudioRoute({
                type: route.route as AudioRouteType,
                maxVolume: route.maxVolume,
            });
            // A boost sits on a maxed system stream, never on the speaker -- the same rules
            // the gesture follows, re-checked because the output may have changed since.
            let percentage = current.volume;
            if (carriedBoost && carriedBoost > 100 && percentage >= 100 && route.route !== 'speaker') {
                percentage = Math.min(carriedBoost, route.maxVolume);
                setBoost(percentage);
            }
            currentVolumeShared.value = percentage / 100;
            setVolumeState(percentage);
            lastSetVolumeRef.current = percentage;
        });

        AudioModule.startListening();

        return () => {
            AudioModule.stopListening();
        };
    }, [currentVolumeShared, carriedBoost, setBoost]);

    // Listen for hardware volume changes (from physical buttons)
    useEffect(() => {
        const subscription: EmitterSubscription = DeviceEventEmitter.addListener(
            'onVolumeChange',
            (event) => {
                if (isGestureActiveRef.current) {
                    return;
                }

                const { volume: newVolume, fromHardware } = event;
                if (!fromHardware) { return; }

                const now = Date.now();

                // Ignore events within 300ms of our last set (system quantization feedback)
                if (now - lastSetTimeRef.current < 300) {
                    return;
                }

                // Boosted, and the system stream is still at max: a re-report of the max
                // must not knock the boost back down to 100%.
                if (newVolume >= 100 && lastSetVolumeRef.current > 100) {
                    return;
                }

                // Ignore if the value is within 5% of what we last set (quantization)
                if (Math.abs(newVolume - lastSetVolumeRef.current) <= 5) {
                    return;
                }

                adoptSystemVolume(newVolume);
                onHardwareVolumeChangeRef.current?.(newVolume);
            }
        );

        return () => {
            subscription.remove();
        };
    }, [adoptSystemVolume]);

    // Listen for route changes
    useEffect(() => {
        const subscription: EmitterSubscription = DeviceEventEmitter.addListener(
            'onAudioRouteChange',
            (event) => {
                const { route, previousRoute, maxVolume, volume: deviceVolume } = event;

                if (__DEV__) {console.log(`[AudioController] Route changed: ${previousRoute} -> ${route} (Max: ${maxVolume}, volume: ${deviceVolume})`);}

                setAudioRoute({
                    type: route as AudioRouteType,
                    maxVolume: maxVolume,
                });

                // Android has already switched to the new device's own stream volume; take
                // it as-is. A boost never follows the user onto another device.
                if (typeof deviceVolume === 'number') {
                    adoptSystemVolume(deviceVolume);
                } else {
                    setBoost(100);
                    AudioModule.getVolume().then((result: any) => adoptSystemVolume(result.volume));
                }
            }
        );

        return () => {
            subscription.remove();
        };
    }, [adoptSystemVolume, setBoost]);

    // Apply volume (called during gestures and manual sets)
    // STABLE CALLBACK: Uses refs to avoid recreation and stale closures
    const applyVolume = useCallback((normalizedValue: number, fromGesture: boolean = false) => {
        if (!AudioModule) {return;}

        if (fromGesture) {
            if (gestureGuardTimerRef.current) { clearTimeout(gestureGuardTimerRef.current); }
            gestureGuardTimerRef.current = null;
            isGestureActiveRef.current = true;
        }

        const currentRoute = audioRouteRef.current;
        const routeMaxNormal = currentRoute.maxVolume / 100;

        // Speaker protection
        let effectiveValue = normalizedValue;
        if (currentRoute.type === 'speaker' && effectiveValue > 1.0) {
            effectiveValue = 1.0;
        }
        effectiveValue = Math.max(0, Math.min(effectiveValue, routeMaxNormal));

        // Convert to percentage (0-200)
        const percentage = Math.round(effectiveValue * 100);

        // Track what we're setting for quantization filtering
        lastSetVolumeRef.current = percentage;
        lastSetTimeRef.current = Date.now();

        const systemPercentage = Math.min(percentage, 100);

        // Use sync method during gestures for better performance (no promise overhead)
        try {
            if (fromGesture && AudioModule.setVolumeSync) {
                AudioModule.setVolumeSync(systemPercentage);
            } else {
                AudioModule.setVolume(systemPercentage).catch((err: any) => {
                    if (__DEV__) {console.warn('[AudioController] setVolume error:', err);}
                });
            }
        } catch (error) {
            if (__DEV__) {console.warn('[AudioController] Native setVolume failed:', error);}
        }

        // 100-200% is the player's boost on top of the maxed system stream
        setBoost(Math.max(100, percentage));

        // Skip React state updates during gesture for smoothness
        // State will sync on gesture end
        if (!fromGesture) {
            setVolumeState(percentage);
        }
    }, [setBoost]);

    // Set volume (0-200 range)
    const setVolume = useCallback((val: number) => {
        applyVolume(val / 100);
    }, [applyVolume]);

    // Volume keys: native consumes them and reports direction + one system step. Stepping
    // here, through applyVolume, lets them walk the whole 0-200% the gesture can, with the
    // same route clamp -- so the speaker still stops at 100%.
    useEffect(() => {
        const subscription: EmitterSubscription = DeviceEventEmitter.addListener(
            'onVolumeKey',
            ({ direction, stepPercent }: { direction: number; stepPercent: number }) => {
                if (isGestureActiveRef.current || !(stepPercent > 0)) { return; }
                const route = audioRouteRef.current;
                const max = route.type === 'speaker' ? 100 : route.maxVolume;
                const index = Math.round(lastSetVolumeRef.current / stepPercent) + direction;
                const next = Math.max(0, Math.min(max, index * stepPercent));
                applyVolume(next / 100);
                const applied = lastSetVolumeRef.current;
                currentVolumeShared.value = applied / 100;
                onHardwareVolumeChangeRef.current?.(applied);
            }
        );
        return () => subscription.remove();
    }, [applyVolume, currentVolumeShared]);

    // Called when gesture ends - syncs React state
    const onGestureEnd = useCallback(() => {
        const finalVolume = Math.round(currentVolumeShared.value * 100);
        setVolumeState(finalVolume);

        // Update tracking to prevent quantized feedback from overriding
        lastSetVolumeRef.current = finalVolume;
        lastSetTimeRef.current = Date.now();

        // Clear gesture guard after a delay (allow system feedback to pass)
        if (gestureGuardTimerRef.current) { clearTimeout(gestureGuardTimerRef.current); }
        gestureGuardTimerRef.current = setTimeout(() => {
            gestureGuardTimerRef.current = null;
            isGestureActiveRef.current = false;
        }, 300);
    }, [currentVolumeShared]);

    return useMemo(() => ({
        volume,
        maxVolume: audioRoute.maxVolume / 100, // Normalized 1.0 or 2.0
        audioRoute,
        currentVolumeShared,
        applyVolume,
        setVolume,
        onGestureEnd,
    }), [
        volume,
        audioRoute,
        currentVolumeShared,
        applyVolume,
        setVolume,
        onGestureEnd,
    ]);
}
