/**
 * usePlayerUI Hook
 *
 * Manages all UI visibility states for the video player:
 * - Controls visibility with auto-hide timer
 * - Lock mode state
 * - Panel states (only one panel open at a time)
 */

import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { VideoOrientationService } from '@/services/VideoOrientationService';
import { haptic } from '@/native/HapticModule';
import {
    UIState,
    PanelType,
    UsePlayerUIReturn,
    PLAYER_CONSTANTS,
} from './types';

const initialUIState: UIState = {
    controlsVisible: true,
    locked: false,
    lockIconVisible: false,
    quickSettingsOpen: false,
    bookmarkPanelOpen: false,
    playlistOpen: false,
    audioSelectorOpen: false,
    subtitleSelectorOpen: false,
};

const panelStateKeys: Record<PanelType, keyof UIState> = {
    quickSettings: 'quickSettingsOpen',
    bookmarkPanel: 'bookmarkPanelOpen',
    playlist: 'playlistOpen',
    audioSelector: 'audioSelectorOpen',
    subtitleSelector: 'subtitleSelectorOpen',
};

const closedPanels = {
    quickSettingsOpen: false,
    bookmarkPanelOpen: false,
    playlistOpen: false,
    audioSelectorOpen: false,
    subtitleSelectorOpen: false,
};

export const anyPanelOpen = (s: UIState) =>
    s.quickSettingsOpen || s.bookmarkPanelOpen || s.playlistOpen || s.audioSelectorOpen || s.subtitleSelectorOpen;

/**
 * Hook for managing video player UI visibility states.
 *
 * Controls auto-hide after 3 s of inactivity while playing; never while paused,
 * scrubbing (see setAutoHideBlocked), with a panel open or with a screen reader on.
 */
/** `startLocked`: the screen lock carried from the previous video by Next / autoplay. */
export function usePlayerUI(orientationLocked: boolean, startLocked = false): UsePlayerUIReturn {
    const [state, setState] = useState<UIState>(
        startLocked ? { ...initialUIState, locked: true, controlsVisible: false } : initialUIState,
    );
    // Unlocking the screen gives rotation back only if the rotation-lock toggle is off.
    const orientationLockedRef = useRef(orientationLocked);
    orientationLockedRef.current = orientationLocked;

    // Shared value for gestures to check lock state in worklets
    const isLockedShared = useSharedValue(startLocked);

    const autoHideTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lockIconTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastInteractionTimeRef = useRef<number>(0);
    const autoHideBlockedRef = useRef(false);
    const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
    const screenReaderRef = useRef(false);

    useEffect(() => {
        const apply = (on: boolean) => {
            screenReaderRef.current = on;
            setScreenReaderEnabled(on);
        };
        AccessibilityInfo.isScreenReaderEnabled().then(apply).catch(() => {});
        const sub = AccessibilityInfo.addEventListener('screenReaderChanged', apply);
        return () => sub.remove();
    }, []);

    useEffect(() => {
        isLockedShared.value = state.locked;
    }, [state.locked, isLockedShared]);

    useEffect(() => {
        return () => {
            if (autoHideTimerRef.current) {clearTimeout(autoHideTimerRef.current);}
            if (lockIconTimerRef.current) {clearTimeout(lockIconTimerRef.current);}
        };
    }, []);

    const cancelAutoHide = useCallback(() => {
        if (autoHideTimerRef.current) {
            clearTimeout(autoHideTimerRef.current);
            autoHideTimerRef.current = null;
        }
    }, []);

    /** Restart the inactivity timer. The check runs against fresh state when it fires. */
    const armAutoHide = useCallback(() => {
        cancelAutoHide();
        autoHideTimerRef.current = setTimeout(() => {
            if (autoHideBlockedRef.current || screenReaderRef.current) {return;}
            setState(s => anyPanelOpen(s) ? s : { ...s, controlsVisible: false });
        }, PLAYER_CONSTANTS.CONTROLS_AUTO_HIDE_MS);
    }, [cancelAutoHide]);

    // Controls start visible, schedule initial auto-hide
    useEffect(() => {
        armAutoHide();
    }, [armAutoHide]);

    // ========================================================================
    // CONTROLS VISIBILITY
    // ========================================================================

    const showControls = useCallback(() => {
        lastInteractionTimeRef.current = Date.now();
        setState(prev => prev.controlsVisible ? prev : { ...prev, controlsVisible: true });
        armAutoHide();
    }, [armAutoHide]);

    const hideControls = useCallback(() => {
        setState(prev => ({ ...prev, controlsVisible: false, quickSettingsOpen: false }));
    }, []);

    const toggleControls = useCallback(() => {
        // A very recent interaction (e.g. button press) means this tap came from the
        // background gesture underneath it.
        if (Date.now() - lastInteractionTimeRef.current < 300) {return;}

        setState(prev => {
            const newVisible = !prev.controlsVisible;
            if (newVisible) {armAutoHide();}
            return {
                ...prev,
                controlsVisible: newVisible,
                quickSettingsOpen: newVisible ? prev.quickSettingsOpen : false,
            };
        });
    }, [armAutoHide]);

    const scheduleAutoHide = useCallback(() => {
        lastInteractionTimeRef.current = Date.now();
        armAutoHide();
    }, [armAutoHide]);

    const setAutoHideBlocked = useCallback((blocked: boolean) => {
        if (autoHideBlockedRef.current === blocked) {return;}
        autoHideBlockedRef.current = blocked;
        if (blocked) {cancelAutoHide();} else {armAutoHide();}
    }, [armAutoHide, cancelAutoHide]);

    // ========================================================================
    // LOCK MODE
    // ========================================================================

    const lock = useCallback(() => {
        VideoOrientationService.disableAuto();
        haptic('toggleOn');
        AccessibilityInfo.announceForAccessibility('Screen locked');
        setState(prev => ({
            ...prev,
            ...closedPanels,
            locked: true,
            controlsVisible: false,
            lockIconVisible: false,
        }));
    }, []);

    const unlock = useCallback(() => {
        if (!orientationLockedRef.current) { VideoOrientationService.enableAuto(); }
        haptic('toggleOff');
        AccessibilityInfo.announceForAccessibility('Screen unlocked');
        if (lockIconTimerRef.current) {clearTimeout(lockIconTimerRef.current);}
        setState(prev => ({
            ...prev,
            locked: false,
            lockIconVisible: false,
            controlsVisible: true,
        }));
        armAutoHide();
    }, [armAutoHide]);

    const toggleLock = useCallback(() => {
        if (state.locked) {unlock();} else {lock();}
    }, [state.locked, lock, unlock]);

    /** A tap while locked (re)shows the unlock chip for 2 s; only the chip itself unlocks. */
    const showLockIconTemporarily = useCallback(() => {
        if (!state.locked) {return;}
        setState(prev => prev.lockIconVisible ? prev : { ...prev, lockIconVisible: true });
        if (lockIconTimerRef.current) {clearTimeout(lockIconTimerRef.current);}
        lockIconTimerRef.current = setTimeout(() => {
            setState(prev => ({ ...prev, lockIconVisible: false }));
        }, 2000);
    }, [state.locked]);

    // ========================================================================
    // PANEL MANAGEMENT
    // ========================================================================

    /** Open a panel, closing any other. Auto-hide waits until it closes. */
    const openPanel = useCallback((panel: PanelType) => {
        lastInteractionTimeRef.current = Date.now();
        cancelAutoHide();
        setState(prev => ({ ...prev, ...closedPanels, [panelStateKeys[panel]]: true }));
    }, [cancelAutoHide]);

    const closePanel = useCallback((panel: PanelType) => {
        lastInteractionTimeRef.current = Date.now();
        setState(prev => ({ ...prev, [panelStateKeys[panel]]: false }));
        if (state.controlsVisible) {armAutoHide();}
    }, [state.controlsVisible, armAutoHide]);

    const closeAllPanels = useCallback(() => {
        setState(prev => ({ ...prev, ...closedPanels }));
        if (state.controlsVisible) {armAutoHide();}
    }, [state.controlsVisible, armAutoHide]);

    return useMemo(() => ({
        state,
        isLockedShared,
        toggleControls,
        showControls,
        hideControls,
        scheduleAutoHide,
        cancelAutoHide,
        setAutoHideBlocked,
        screenReaderEnabled,
        lock,
        unlock,
        toggleLock,
        showLockIconTemporarily,
        openPanel,
        closePanel,
        closeAllPanels,
    }), [
        state, isLockedShared,
        toggleControls, showControls, hideControls, scheduleAutoHide, cancelAutoHide, setAutoHideBlocked, screenReaderEnabled,
        lock, unlock, toggleLock, showLockIconTemporarily,
        openPanel, closePanel, closeAllPanels,
    ]);
}

export default usePlayerUI;
