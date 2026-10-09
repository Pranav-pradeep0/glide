/**
 * usePlayerHUD Hook - FIXED
 *
 * Fixed: Speed HUD now only hides visually during gesture, doesn't reset rate
 * until gesture explicitly ends via resetSpeed()
 */

import { useReducer, useCallback, useRef, useMemo, useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';
import {
    HUDState,
    HUDAction,
    UsePlayerHUDReturn,
    PLAYER_CONSTANTS,
} from './types';

// ============================================================================
// INITIAL STATE
// ============================================================================

export const initialHUDState: HUDState = {
    seek: { show: false, time: 0, startTime: 0, direction: null, side: null },
    brightness: { show: false, value: 0.5 },
    volume: { show: false, value: 0.5 },
    speed: { show: false, rate: 1.0 },
    resize: { show: false, mode: 'contain' },
    zoom: { scale: 1 },
    ripple: { show: false, side: 'right', seconds: 0, x: 0, y: 0, at: 0 },
};

// ============================================================================
// REDUCER
// ============================================================================

export function hudReducer(state: HUDState, action: HUDAction): HUDState {
    switch (action.type) {
        case 'SHOW_SEEK':
            // OPTIMIZATION: If already showing with same static props, don't update
            // Dynamic time/value is handled by SharedValues in VideoHUD
            if (state.seek.show &&
                state.seek.startTime === action.startTime &&
                state.seek.direction === action.direction &&
                state.seek.side === action.side) {
                return state;
            }
            return {
                ...state,
                seek: {
                    show: true,
                    time: action.time,
                    startTime: action.startTime,
                    direction: action.direction,
                    side: action.side,
                },
            };
        // Every HIDE used to allocate a new state object whether or not the HUD was
        // showing, and showBrightnessHUD dispatches HIDE_VOLUME unconditionally -- so a
        // brightness drag re-rendered the whole player on every frame for nothing.
        case 'HIDE_SEEK':
            if (!state.seek.show) {return state;}
            return {
                ...state,
                seek: { ...state.seek, show: false },
            };
        case 'SHOW_BRIGHTNESS':
            // OPTIMIZATION: If already showing, don't update (value handled by SharedValue)
            if (state.brightness.show) {return state;}
            return {
                ...state,
                brightness: { show: true, value: action.value },
            };
        case 'HIDE_BRIGHTNESS':
            if (!state.brightness.show) {return state;}
            return {
                ...state,
                brightness: { ...state.brightness, show: false },
            };
        case 'SHOW_VOLUME':
            // OPTIMIZATION: If already showing, don't update (value handled by SharedValue)
            if (state.volume.show) {return state;}
            return {
                ...state,
                volume: { show: true, value: action.value },
            };
        case 'HIDE_VOLUME':
            if (!state.volume.show) {return state;}
            return {
                ...state,
                volume: { ...state.volume, show: false },
            };
        case 'SHOW_SPEED':
            return {
                ...state,
                speed: { show: true, rate: action.rate },
            };
        case 'HIDE_SPEED':
            // ✅ FIX: Only hide the visual HUD, keep the current rate
            if (!state.speed.show) {return state;}
            return {
                ...state,
                speed: { ...state.speed, show: false },
            };
        case 'RESET_SPEED':
            return {
                ...state,
                speed: { show: false, rate: 1.0 },
            };
        case 'SHOW_RESIZE':
            return {
                ...state,
                resize: { show: true, mode: action.mode },
            };
        case 'HIDE_RESIZE':
            if (!state.resize.show) {return state;}
            return {
                ...state,
                resize: { ...state.resize, show: false },
            };
        case 'UPDATE_ZOOM':
            // Must return the same state object for the same scale. Fabricating a
            // new one gave the memoized hud object a new identity, which changed
            // every callback depending on it, which re-triggered the effect that
            // called this — an unbounded render loop.
            if (state.zoom.scale === action.scale) {
                return state;
            }
            return {
                ...state,
                zoom: { scale: action.scale },
            };
        case 'RESET_ALL':
            return initialHUDState;
        case 'SHOW_RIPPLE':
            return {
                ...state,
                ripple: { show: true, side: action.side, seconds: action.seconds, x: action.x, y: action.y, at: action.at },
            };
        case 'HIDE_RIPPLE':
            if (!state.ripple.show) {return state;}
            return {
                ...state,
                ripple: { ...state.ripple, show: false },
            };
        default:
            return state;
    }
}

// ============================================================================
// HOOK
// ============================================================================

export function usePlayerHUD(): UsePlayerHUDReturn {
    const [state, dispatch] = useReducer(hudReducer, initialHUDState);

    // Timer refs
    const timerRefs = useRef({
        seek: null as NodeJS.Timeout | null,
        brightness: null as NodeJS.Timeout | null,
        volume: null as NodeJS.Timeout | null,
        speed: null as NodeJS.Timeout | null,
        resize: null as NodeJS.Timeout | null,
        ripple: null as NodeJS.Timeout | null,
    });

    // Track seek start time for difference calculation
    const seekStartTimeRef = useRef<number>(0);

    // ✅ NEW: Track if speed gesture is currently active
    const speedGestureActiveRef = useRef(false);

    // ========================================================================
    // CLEANUP HELPER
    // ========================================================================

    const clearTimer = useCallback((type: keyof typeof timerRefs.current) => {
        if (timerRefs.current[type]) {
            clearTimeout(timerRefs.current[type]!);
            timerRefs.current[type] = null;
        }
    }, []);

    // ========================================================================
    // SEEK HUD
    // ========================================================================

    const showSeekHUD = useCallback((
        time: number,
        direction: 'forward' | 'backward' | null = null,
        side: 'left' | 'right' | null = null,
        isGestureActive: boolean = false
    ) => {
        // If no direction specified, calculate from time difference
        let effectiveDirection = direction;
        let startTime = seekStartTimeRef.current;

        // If this is the first seek call and no startTime set, capture it
        if (startTime === 0) {
            startTime = time;
            seekStartTimeRef.current = time;
        }

        // Calculate direction from time difference if not provided
        if (effectiveDirection === null && startTime !== time) {
            effectiveDirection = time > startTime ? 'forward' : 'backward';
        }

        // The skip this used to do here read `state`, which the callback never listed as a
        // dependency, so it was always the state from the first render and the check never
        // fired. SHOW_SEEK makes exactly the same comparison against the live state and
        // returns it unchanged, which costs no render -- so just dispatch.
        dispatch({
            type: 'SHOW_SEEK',
            time,
            startTime,
            direction: effectiveDirection,
            side,
        });

        clearTimer('seek');

        // Only auto-hide if gesture is not active
        if (!isGestureActive) {
            timerRefs.current.seek = setTimeout(() => {
                dispatch({ type: 'HIDE_SEEK' });
                // Reset start time ref when seek HUD hides
                seekStartTimeRef.current = 0;
            }, PLAYER_CONSTANTS.HUD_HIDE_MS);
        }
    }, [clearTimer]);

    // Helper to set seek start time (called when gesture begins)
    // If forceNewStart is false and HUD is visible, don't update (for cumulative double taps)
    const setSeekStartTime = useCallback((time: number, forceNewStart: boolean = true) => {
        if (forceNewStart || seekStartTimeRef.current === 0) {
            seekStartTimeRef.current = time;
        }
    }, []);

    const hideSeekHUD = useCallback(() => {
        clearTimer('seek');
        seekStartTimeRef.current = 0;
        dispatch({ type: 'HIDE_SEEK' });
    }, [clearTimer]);

    // ========================================================================
    // BRIGHTNESS HUD
    // ========================================================================

    const showBrightnessHUD = useCallback((value: number, isGestureActive = false) => {
        clearTimer('volume');
        dispatch({ type: 'HIDE_VOLUME' });
        dispatch({ type: 'SHOW_BRIGHTNESS', value });
        clearTimer('brightness');

        // Don't auto-hide if gesture is active
        if (!isGestureActive) {
            timerRefs.current.brightness = setTimeout(() => {
                dispatch({ type: 'HIDE_BRIGHTNESS' });
            }, PLAYER_CONSTANTS.HUD_HIDE_MS);
        }
    }, [clearTimer]);

    const hideBrightnessHUD = useCallback(() => {
        clearTimer('brightness');
        dispatch({ type: 'HIDE_BRIGHTNESS' });
    }, [clearTimer]);

    // ========================================================================
    // VOLUME HUD
    // ========================================================================

    const showVolumeHUD = useCallback((value: number, isGestureActive = false) => {
        clearTimer('brightness');
        dispatch({ type: 'HIDE_BRIGHTNESS' });
        dispatch({ type: 'SHOW_VOLUME', value });
        clearTimer('volume');

        if (!isGestureActive) {
            timerRefs.current.volume = setTimeout(() => {
                dispatch({ type: 'HIDE_VOLUME' });
            }, PLAYER_CONSTANTS.HUD_HIDE_MS);
        }
    }, [clearTimer]);

    const hideVolumeHUD = useCallback(() => {
        clearTimer('volume');
        dispatch({ type: 'HIDE_VOLUME' });
    }, [clearTimer]);

    // ========================================================================
    // SPEED HUD - FIXED
    // ========================================================================

    const showSpeedHUD = useCallback((rate: number, isGestureActive = false) => {
        dispatch({ type: 'SHOW_SPEED', rate });

        // ✅ Track if this is from an active gesture
        speedGestureActiveRef.current = isGestureActive;

        clearTimer('speed');

        // ✅ Don't auto-hide if gesture is active
        if (!isGestureActive) {
            timerRefs.current.speed = setTimeout(() => {
                dispatch({ type: 'HIDE_SPEED' });
            }, PLAYER_CONSTANTS.SPEED_HUD_HIDE_MS);
        }
    }, [clearTimer]);

    const hideSpeedHUD = useCallback(() => {
        clearTimer('speed');
        dispatch({ type: 'HIDE_SPEED' });
    }, [clearTimer]);

    // ========================================================================
    // RESIZE HUD
    // ========================================================================

    const showResizeHUD = useCallback((mode: string) => {
        dispatch({ type: 'SHOW_RESIZE', mode });
        clearTimer('resize');
        timerRefs.current.resize = setTimeout(() => {
            dispatch({ type: 'HIDE_RESIZE' });
        }, PLAYER_CONSTANTS.HUD_HIDE_MS);
    }, [clearTimer]);

    const hideResizeHUD = useCallback(() => {
        clearTimer('resize');
        dispatch({ type: 'HIDE_RESIZE' });
    }, [clearTimer]);

    /**
     * ✅ FIXED: Reset speed - called when gesture ends
     * This is the only place that resets rate back to 1.0
     */
    const resetSpeed = useCallback(() => {
        speedGestureActiveRef.current = false;
        clearTimer('speed');
        dispatch({ type: 'RESET_SPEED' });
    }, [clearTimer]);

    // ========================================================================
    // ZOOM HUD
    // ========================================================================

    const updateZoom = useCallback((scale: number) => {
        dispatch({ type: 'UPDATE_ZOOM', scale });
    }, []);

    // ========================================================================
    // RESET ALL
    // ========================================================================

    const resetAll = useCallback(() => {
        clearTimer('seek');
        clearTimer('brightness');
        clearTimer('volume');
        clearTimer('speed');
        clearTimer('resize');
        clearTimer('ripple');
        speedGestureActiveRef.current = false;
        seekStartTimeRef.current = 0;
        dispatch({ type: 'RESET_ALL' });
    }, [clearTimer]);

    // ========================================================================
    // RIPPLE HUD
    // ========================================================================

    const showRipple = useCallback((side: 'left' | 'right', seconds: number, x: number, y: number) => {
        dispatch({ type: 'SHOW_RIPPLE', side, seconds, x, y, at: Date.now() });
        clearTimer('ripple');
        // The run ends when this fires: announce the total once rather than every tap.
        timerRefs.current.ripple = setTimeout(() => {
            dispatch({ type: 'HIDE_RIPPLE' });
            AccessibilityInfo.announceForAccessibility(`${side === 'left' ? 'Back' : 'Forward'} ${seconds} seconds`);
        }, PLAYER_CONSTANTS.RIPPLE_DURATION_MS);
    }, [clearTimer]);

    const hideRipple = useCallback(() => {
        clearTimer('ripple');
        dispatch({ type: 'HIDE_RIPPLE' });
    }, [clearTimer]);

    // ========================================================================
    // CLEANUP ON UNMOUNT
    // ========================================================================

    useEffect(() => {
        return () => {
            const timers = timerRefs.current;
            if (timers.seek) {clearTimeout(timers.seek);}
            if (timers.brightness) {clearTimeout(timers.brightness);}
            if (timers.volume) {clearTimeout(timers.volume);}
            if (timers.speed) {clearTimeout(timers.speed);}
            if (timers.resize) {clearTimeout(timers.resize);}
            if (timers.ripple) {clearTimeout(timers.ripple);}
        };
    }, []);

    // ========================================================================
    // RETURN
    // ========================================================================

    return useMemo(() => ({
        state,
        showSeekHUD,
        hideSeekHUD,
        setSeekStartTime,
        showBrightnessHUD,
        hideBrightnessHUD,
        showVolumeHUD,
        hideVolumeHUD,
        showSpeedHUD,
        hideSpeedHUD,
        showResizeHUD,
        hideResizeHUD,
        resetSpeed,
        updateZoom,
        resetAll,
        showRipple,
        hideRipple,
    }), [
        state,
        showSeekHUD, hideSeekHUD, setSeekStartTime,
        showBrightnessHUD, hideBrightnessHUD,
        showVolumeHUD, hideVolumeHUD,
        showSpeedHUD, hideSpeedHUD,
        showResizeHUD, hideResizeHUD,
        resetSpeed, updateZoom, resetAll,
        showRipple, hideRipple,
    ]);
}

export default usePlayerHUD;
