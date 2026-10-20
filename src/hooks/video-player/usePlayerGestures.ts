/**
 * usePlayerGestures Hook
 *
 * Main gesture compositor for the video player.
 * Combines all gesture sub-hooks into a single composed gesture.
 * Also provides the animated style for video zoom/pan.
 *
 * CRITICAL: This hook orchestrates all gesture handling.
 * Changes here can break the entire gesture system.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions, NativeModules } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
    useSharedValue,
    useAnimatedStyle,
    SharedValue,
    runOnJS,
} from 'react-native-reanimated';
import type { PlayerResizeMode } from '@/components/VideoPlayer/GlidePlayer';
import { haptic } from '@/native/HapticModule';
import { VideoOrientationService } from '@/services/VideoOrientationService';

const { DisplayBrightnessModule: BrightnessModule } = NativeModules;

import { UsePlayerCoreReturn, UsePlayerUIReturn, UsePlayerHUDReturn, PLAYER_CONSTANTS } from './types';
import { useSeekGesture } from './useSeekGesture';
import { useBrightnessGesture } from './useBrightnessGesture';
import { useVolumeGesture } from './useVolumeGesture';
import { useSpeedGesture } from './useSpeedGesture';
import { useZoomGesture } from './useZoomGesture';
import { useTapGestures } from './useTapGestures';

// ============================================================================
// TYPES
// ============================================================================

interface UsePlayerGesturesOptions {
    player: UsePlayerCoreReturn;
    ui: UsePlayerUIReturn;
    hud: UsePlayerHUDReturn;
    basePlaybackRate?: number;
    onTemporarySpeedChange?: (rate: number | null) => void;

    // Optional callbacks
    onSeekUpdate?: (time: number, show: boolean) => void;
    onBrightnessChange?: (value: number) => void;
    onBrightnessSave?: (value: number) => void;
    initialBrightness?: number;
    /** The previous episode's volume (0-200); only a boost above 100 is re-applied. */
    carriedVolume?: number;
    resizeMode?: PlayerResizeMode;
    isInPipMode?: boolean;
}

interface UsePlayerGesturesReturn {
    // The composed gesture to use with GestureDetector
    composedGesture: ReturnType<typeof Gesture.Race>;

    // Animated style for the video container (handles zoom/pan transforms)
    videoAnimatedStyle: ReturnType<typeof useAnimatedStyle>;

    // Shared values exposed for UI consumption (VideoHUD)
    sharedValues: {
        zoomActive: SharedValue<boolean>;
        pinchScale: SharedValue<number>;
        currentBrightness: SharedValue<number>;
        currentVolume: SharedValue<number>;
        seekTime: SharedValue<number>;
        /** A horizontal swipe-seek is in progress: the seek bar shows its scrubbing state. */
        swipeSeeking: SharedValue<boolean>;
        /** Where that swipe started, for the bubble's delta. */
        swipeSeekStart: SharedValue<number>;
    };

    // Current volume max (100 or 200)
    maxVolume: number;
    /** 0-200, as last settled (not mid-gesture). */
    volume: number;

    // Helper to reset zoom
    resetZoom: () => void;


}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Main gesture hook that composes all gesture handlers.
 *
 * Gesture priority (using Race and Exclusive combiners):
 * 1. Pinch (zoom) - highest priority
 * 2. Speed gestures (long press) - need to activate before pan
 * 3. Tap gestures (single/double) - should work everywhere
 * 4. Pan gestures (seek, brightness, volume, zoom-pan) - fallback
 */
import { useAudioController } from './useAudioController';

// ...

export function usePlayerGestures(options: UsePlayerGesturesOptions): UsePlayerGesturesReturn {
    const {
        player,
        ui,
        hud,
        basePlaybackRate = 1.0,
        onTemporarySpeedChange,
        onSeekUpdate,
        initialBrightness,
        carriedVolume,
        onBrightnessChange,
        onBrightnessSave,
        resizeMode = 'contain',
        isInPipMode = false,
    } = options;

    // Narrow to stable members rather than depending on `player`. Playback position no
    // longer lives in player state, so its identity is stable during playback, but
    // depending on the whole object would re-tie the gesture tree to unrelated state.
    const { setIsSeeking, previewSeek, commitSeek, currentTimeRef, togglePlayPause } = player;
    // resetZoom must not depend on the whole hud object: it calls updateZoom, which
    // changes hud.state, which would change resetZoom, which re-runs the effect below
    // that calls resetZoom. updateZoom itself is stable.
    const { updateZoom: updateHudZoom } = hud;

    const { width, height } = useWindowDimensions();

    // The system Back gesture's edge strips; re-read when a rotation moves them.
    const [backEdges, setBackEdges] = useState({ left: 0, right: 0 });
    useEffect(() => {
        let live = true;
        VideoOrientationService.getSystemGestureInsets()
            .then(insets => { if (live && insets) { setBackEdges(insets); } })
            .catch(() => { });
        return () => { live = false; };
    }, [width, height]);

    // ========================================================================
    // AUDIO CONTROLLER
    // ========================================================================

    // Callback for hardware volume button presses - show volume HUD
    const handleHardwareVolumeChange = useCallback((volume: number) => {
        // Show HUD with isGestureActive=false so it auto-hides
        hud.showVolumeHUD(volume / 100, false);
    }, [hud]);

    // Initialize Audio Controller
    const audioController = useAudioController(player.videoRef, 100, handleHardwareVolumeChange, carriedVolume);

    // ========================================================================
    // SHARED VALUES FOR GESTURES
    // ========================================================================

    // Seek gesture
    const seekStartTime = useSharedValue(0);
    const seekOffset = useSharedValue(0);
    const gestureActive = useSharedValue(false);
    // New: dedicated shared value for the calculated seek time (for HUD)
    const seekTimeShared = useSharedValue(0);

    // Brightness gesture
    const currentBrightness = useSharedValue(initialBrightness ?? 0.5);
    const brightnessStart = useSharedValue(initialBrightness ?? 0.5);

    // Volume gesture - Use shared value from controller
    const currentVolume = audioController.currentVolumeShared;
    const volumeStart = useSharedValue(0.5);

    // Speed gesture
    const speedBase = useSharedValue(2.0);
    const speedGestureActive = useSharedValue(false);
    const lastSpeedUpdate = useSharedValue(2.0);

    // Zoom gesture
    const pinchScale = useSharedValue(1);
    const pinchScaleStart = useSharedValue(1);
    const panX = useSharedValue(0);
    const panY = useSharedValue(0);
    const panStartX = useSharedValue(0);
    const panStartY = useSharedValue(0);
    const zoomActive = useSharedValue(false);

    // ========================================================================
    // SCREEN ZONES
    // ========================================================================

    // Vertical swipes: left half brightness, right half volume (standard convention).
    const halfWidth = width / 2;
    const allowVideoTransform = resizeMode === 'contain' && !isInPipMode;



    // ========================================================================
    // SYSTEM INTEGRATIONS
    // ========================================================================

    const setBrightnessNative = useCallback((val: number, isFinal: boolean = false) => {
        const brightness = Math.max(0, Math.min(1, val));
        // Use window-only sync updates during the gesture, then commit once at the end.
        if (BrightnessModule?.setBrightnessSync) {
            BrightnessModule.setBrightnessSync(brightness);
        } else if (BrightnessModule?.setBrightness) {
            const result = BrightnessModule.setBrightness(brightness);
            if (result && typeof result.catch === 'function') {
                result.catch(() => { });
            }
        }

        // Notify JS callback for persistence
        if (onBrightnessChange) {
            runOnJS(onBrightnessChange)(brightness);
        }

        if (isFinal && onBrightnessSave) {
            runOnJS(onBrightnessSave)(brightness);
        }
    }, [onBrightnessChange, onBrightnessSave]);

    // NOTE: setVolumeNative is removed in favor of audioController.applyVolume

    // Initialize brightness from system
    useEffect(() => {
        const init = async () => {
            try {
                if (initialBrightness !== undefined) {
                    currentBrightness.value = initialBrightness;
                    if (onBrightnessChange) {onBrightnessChange(initialBrightness);}

                    if (BrightnessModule) {
                        if (BrightnessModule.setBrightnessSync) {
                            BrightnessModule.setBrightnessSync(initialBrightness);
                        } else {
                            BrightnessModule.setBrightness(initialBrightness);
                        }
                    }
                } else if (BrightnessModule) {
                    const deviceBrightness = await BrightnessModule.getBrightness();
                    currentBrightness.value = Math.max(0, Math.min(1, typeof deviceBrightness === 'number' ? deviceBrightness : 0.5));
                }
            } catch {
                if (initialBrightness === undefined) {
                    currentBrightness.value = 0.5;
                }
            }
            // Volume initialization is handled inside useAudioController now
        };
        init();
    }, [currentBrightness, initialBrightness, onBrightnessChange]);

    // ========================================================================
    // ZOOM HELPERS
    // ========================================================================

    const resetZoom = useCallback(() => {
        pinchScale.value = 1;
        panX.value = 0;
        panY.value = 0;
        zoomActive.value = false;
        updateHudZoom(1);
    }, [pinchScale, panX, panY, zoomActive, updateHudZoom]);

    useEffect(() => {
        if (!allowVideoTransform) {
            resetZoom();
        }
    }, [allowVideoTransform, resetZoom]);

    // ========================================================================
    // GESTURE CALLBACKS
    // ========================================================================

    // Seek. The seek bar's scrubbing state is the readout (driven by swipeSeeking on
    // the UI thread); controls hidden before the swipe stay hidden after it.
    const handleSeekStart = useCallback(() => {
        setIsSeeking(true);
    }, [setIsSeeking]);

    const handleSeekUpdate = useCallback((time: number) => {
        previewSeek(time);
        onSeekUpdate?.(time, true);
    }, [previewSeek, onSeekUpdate]);

    const { scheduleAutoHide } = ui;
    const handleSeekComplete = useCallback((time: number) => {
        commitSeek(time);
        scheduleAutoHide();
    }, [commitSeek, scheduleAutoHide]);

    // Lock tap
    const handleLockTap = useCallback(() => {
        ui.showLockIconTemporarily();
    }, [ui]);

    // Brightness
    const handleBrightnessChange = useCallback((value: number) => {
        // Only show HUD container, value is via shared value
        hud.showBrightnessHUD(value, true);
    }, [hud]);

    const handleBrightnessEnd = useCallback(() => {
        // Signal gesture end to start auto-hide timer
        // We pass current value to keep state consistent, though visual is shared-value driven
        hud.showBrightnessHUD(currentBrightness.value, false);
    }, [hud, currentBrightness]);

    // Volume
    const handleVolumeChange = useCallback((value: number) => {
        // Pass audio route type to HUD if needed (not yet implemented in HUD API)
        hud.showVolumeHUD(value, true);
    }, [hud]);

    const handleVolumeEnd = useCallback(() => {
        hud.showVolumeHUD(currentVolume.value, false);
        audioController.onGestureEnd(); // Clear the gesture guard
    }, [hud, currentVolume, audioController]);

    // Speed
    const speedHoldRef = useRef(false);

    const handleSpeedChange = useCallback((rate: number, isGestureActive?: boolean) => {
        if (isGestureActive && !speedHoldRef.current) {
            speedHoldRef.current = true;
            haptic('longPress');
        }
        onTemporarySpeedChange?.(rate);
        hud.showSpeedHUD(rate, isGestureActive);
    }, [hud, onTemporarySpeedChange]);

    const handleSpeedReset = useCallback(() => {
        if (speedHoldRef.current) {
            speedHoldRef.current = false;
            haptic('gestureEnd');
        }
        onTemporarySpeedChange?.(null);
        hud.showSpeedHUD(basePlaybackRate, false);
    }, [basePlaybackRate, hud, onTemporarySpeedChange]);

    // Zoom
    const handleZoomStart = useCallback(() => {
        ui.hideControls();
    }, [ui]);

    const handleZoomUpdate = useCallback((scale: number) => {
        hud.updateZoom(scale);
    }, [hud]);

    // Tap
    // A double tap starts a run; every further tap on that side within 800 ms adds
    // another step. Each tap is measured from the previous one, so the run lasts as
    // long as the tapping does.
    const seekRunRef = useRef<{ side: 'left' | 'right'; base: number; seconds: number; lastAt: number } | null>(null);
    const { durationShared } = player;
    const { showRipple } = hud;
    const { hideControls } = ui;

    const runSeek = useCallback((side: 'left' | 'right', taps: number, tapAt: number, x: number, y: number) => {
        const step = PLAYER_CONSTANTS.DOUBLE_TAP_SEEK_SECONDS;
        const prev = seekRunRef.current;
        const continuing = !!prev && prev.side === side && tapAt - prev.lastAt < PLAYER_CONSTANTS.RIPPLE_DURATION_MS;
        const run = prev && continuing
            ? { ...prev, seconds: prev.seconds + step * taps, lastAt: tapAt }
            : { side, base: currentTimeRef.current, seconds: step, lastAt: tapAt };

        const target = run.base + (side === 'left' ? -run.seconds : run.seconds);
        const newTime = Math.max(0, Math.min(durationShared.value || 0, target));

        // Nothing is announced until the seek is accepted. A double tap in the ~430 ms
        // before the duration is known is dropped by the player.
        if (!commitSeek(newTime)) {
            seekRunRef.current = null;
            return;
        }
        seekRunRef.current = run;
        if (!continuing) {
            haptic('tick');
            // The side readout sits where the jump buttons are; get them out of the way.
            hideControls();
        }
        showRipple(side, run.seconds, x, y);
    }, [commitSeek, currentTimeRef, durationShared, showRipple, hideControls]);

    // Double-tap zones: outer 40% each side seeks, the middle 20% plays/pauses.
    const zoneAt = useCallback((x: number) => (
        x < width * 0.4 ? 'left' : x > width * 0.6 ? 'right' : 'center'
    ), [width]);

    const handleDoubleTap = useCallback((x: number, y: number) => {
        const zone = zoneAt(x);
        if (zone === 'center') {
            // Controls stay as they are; VideoHUD flashes the new state if they're hidden.
            togglePlayPause();
            return;
        }
        runSeek(zone, 2, Date.now(), x, y);
    }, [zoneAt, runSeek, togglePlayPause]);

    const handleSingleTap = useCallback((x: number, y: number, tapAt: number) => {
        if (ui.state.locked) {
            // Taps never unlock: only the chip does (kids, pockets).
            ui.showLockIconTemporarily();
            return;
        }
        const zone = zoneAt(x);
        const run = seekRunRef.current;
        if (run && run.side === zone && tapAt - run.lastAt < PLAYER_CONSTANTS.RIPPLE_DURATION_MS) {
            runSeek(zone, 1, tapAt, x, y);
            return;
        }
        ui.toggleControls();
    }, [ui, zoneAt, runSeek]);

    // ========================================================================
    // CREATE INDIVIDUAL GESTURES
    // ========================================================================

    const seekGesture = useSeekGesture({
        currentTimeShared: player.currentTimeShared,
        durationShared: player.durationShared,
        isLockedShared: ui.isLockedShared,
        seekStartTime,
        seekOffset,
        gestureActive,
        seekTimeShared,
        onSeekStart: handleSeekStart,
        onSeekUpdate: handleSeekUpdate, // This is now throttled
        onSeekComplete: handleSeekComplete,
        onLockTap: handleLockTap,
        backEdges,
    });

    const brightnessGesture = useBrightnessGesture({
        screenWidth: width,
        leftZoneWidth: halfWidth,
        isLockedShared: ui.isLockedShared,
        currentBrightness,
        brightnessStart,
        onBrightnessChange: handleBrightnessChange,
        onBrightnessApply: setBrightnessNative,
        onGestureStart: ui.hideControls,
        onGestureEnd: handleBrightnessEnd,
        onLockTap: handleLockTap,
    });

    const volumeGesture = useVolumeGesture({
        screenWidth: width,
        rightZoneWidth: halfWidth,
        isLockedShared: ui.isLockedShared,
        currentVolume: audioController.currentVolumeShared,
        volumeStart,
        maxVolume: audioController.maxVolume, // Already normalized 1.0 or 2.0
        onVolumeChange: handleVolumeChange,
        onVolumeApply: audioController.applyVolume,
        onGestureStart: ui.hideControls,
        onGestureEnd: handleVolumeEnd,
        onLockTap: handleLockTap,
    });

    const { rightGesture: speedRightGesture, leftGesture: speedLeftGesture } = useSpeedGesture({
        screenWidth: width,
        isLockedShared: ui.isLockedShared,
        speedBase,
        speedGestureActive,
        lastSpeedUpdate,
        onSpeedChange: handleSpeedChange,
        onSpeedReset: handleSpeedReset,
        onGestureStart: ui.hideControls,
        onLockTap: handleLockTap,
    });

    const { pinchGesture, panGesture: zoomPanGesture } = useZoomGesture({
        screenWidth: width,
        screenHeight: height,
        isLockedShared: ui.isLockedShared,
        pinchScale,
        pinchScaleStart,
        panX,
        panY,
        panStartX,
        panStartY,
        zoomActive,
        enabled: allowVideoTransform,
        onZoomStart: handleZoomStart,
        onZoomUpdate: handleZoomUpdate,
        onZoomReset: resetZoom,
        onLockTap: handleLockTap,
    });

    const tapGestures = useTapGestures({
        isLockedShared: ui.isLockedShared,
        onSingleTap: handleSingleTap,
        onDoubleTap: handleDoubleTap,
        onLockTap: handleLockTap,
    });

    // ========================================================================
    // COMPOSE ALL GESTURES
    // ========================================================================

    const composedGesture = useMemo(() => {
        // Speed gestures (left and right)
        const speedGestures = Gesture.Race(speedRightGesture, speedLeftGesture);

        // Vertical pan gestures (brightness left, volume right)
        const verticalGestures = Gesture.Exclusive(brightnessGesture, volumeGesture);

        // All pan gestures (horizontal seek, vertical brightness/volume)
        // Note: zoomPanGesture is REMOVED from here to be simultaneous with Pinch
        const panGestures = Gesture.Exclusive(seekGesture, verticalGestures);

        // Simultaneous Zoom + Pan (2 fingers)
        const zoomMultiGesture = Gesture.Simultaneous(pinchGesture, zoomPanGesture);

        // Final composition:
        // 1. Zoom/Pan (2 fingers) - wins if 2 fingers detected
        // 2. Speed gestures (long press)
        // 3. Tap gestures
        // 4. Pan gestures (fallback - 1 finger)
        return Gesture.Race(zoomMultiGesture, speedGestures, tapGestures, panGestures);
    }, [
        pinchGesture,
        speedRightGesture,
        speedLeftGesture,
        tapGestures,
        seekGesture,
        brightnessGesture,
        volumeGesture,
        zoomPanGesture,
    ]);

    // ========================================================================
    // ANIMATED STYLE FOR VIDEO ZOOM/PAN
    // ========================================================================

    const videoAnimatedStyle = useAnimatedStyle(() => {
        return {
            transform: [
                { scale: allowVideoTransform ? pinchScale.value : 1 },
                { translateX: allowVideoTransform ? panX.value : 0 },
                { translateY: allowVideoTransform ? panY.value : 0 },
            ],
        };
    });

    // ========================================================================
    // RETURN
    // ========================================================================

    return useMemo(() => ({
        composedGesture,
        videoAnimatedStyle,
        sharedValues: {
            zoomActive,
            pinchScale,
            currentBrightness,
            currentVolume,
            seekTime: seekTimeShared,
            swipeSeeking: gestureActive,
            swipeSeekStart: seekStartTime,
        },
        maxVolume: audioController.maxVolume,
        volume: audioController.volume,
        resetZoom,
    }), [
        composedGesture, videoAnimatedStyle,
        zoomActive, pinchScale, currentBrightness, currentVolume, seekTimeShared, gestureActive, seekStartTime,
        audioController.maxVolume, audioController.volume, resetZoom,
    ]);
}

export default usePlayerGestures;
