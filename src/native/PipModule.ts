/**
 * PipModule — Picture-in-Picture state, reported from native.
 *
 * PiP is owned by the native video view, which is the only place that knows the
 * video's real dimensions, the surface bounds in pixels and whether playback is
 * live. JS does not configure PiP: it says whether PiP is currently allowed (the
 * `pipEnabled` prop on the player) and reacts to the mode change reported here.
 *
 * To enter PiP, call `enterPictureInPicture()` on the player ref.
 */

import { NativeModules, NativeEventEmitter, Platform, AppState } from 'react-native';
import { useEffect, useState } from 'react';

const { PipModule: NativePipModule } = NativeModules;

const PIP_MODE_CHANGED_EVENT = 'onPipModeChanged';

interface PipModeEvent {
    isInPipMode: boolean;
}

/**
 * Check if the app is currently in PIP mode
 */
export async function isInPipMode(): Promise<boolean> {
    if (Platform.OS !== 'android' || !NativePipModule) {
        return false;
    }

    try {
        return await NativePipModule.isInPipMode();
    } catch (error) {
        console.error('[PipModule] Failed to check PIP mode:', error);
        return false;
    }
}

/**
 * Check if PIP is supported on this device
 */
export async function isPipSupported(): Promise<boolean> {
    if (Platform.OS !== 'android' || !NativePipModule) {
        return false;
    }

    try {
        return await NativePipModule.isPipSupported();
    } catch (error) {
        console.error('[PipModule] Failed to check PIP support:', error);
        return false;
    }
}

/**
 * Close the Activity hosting the player. Used for externally opened videos, where
 * dismissing the player should close this Activity rather than exit the app.
 */
export async function finishCurrentActivity(): Promise<boolean> {
    if (Platform.OS !== 'android' || !NativePipModule) {
        return false;
    }

    try {
        return await NativePipModule.finishCurrentActivity();
    } catch (error) {
        console.error('[PipModule] Failed to finish activity:', error);
        return false;
    }
}

/**
 * The simple class name of the Activity in front, e.g. 'VideoPlayerActivity', or null.
 * Undefined on APKs from before the native freeze, which lack the method.
 */
export function currentActivityName(): string | null | undefined {
    if (Platform.OS !== 'android' || typeof NativePipModule?.currentActivityName !== 'function') {
        return undefined;
    }
    try {
        return NativePipModule.currentActivityName();
    } catch {
        return undefined;
    }
}

/**
 * Hook to listen for PIP mode changes.
 * The native callback is authoritative, so there is nothing to poll.
 */
export function usePipModeListener(): boolean {
    const [isInPip, setIsInPip] = useState(false);

    useEffect(() => {
        if (Platform.OS !== 'android' || !NativePipModule) {
            return;
        }

        const eventEmitter = new NativeEventEmitter<{
            [PIP_MODE_CHANGED_EVENT]: [PipModeEvent];
        }>(NativePipModule);
        const subscription = eventEmitter.addListener(
            PIP_MODE_CHANGED_EVENT,
            (event: PipModeEvent) => setIsInPip(event.isInPipMode)
        );

        let cancelled = false;
        const syncFromNative = () => {
            isInPipMode().then((inPip) => {
                if (!cancelled) {
                    setIsInPip(inPip);
                }
            });
        };

        // The event above is the fast path. This is the safety net: if it is ever
        // missed, JS would keep rendering overlays that then show up inside the PiP
        // window. Re-checking on app state transitions costs nothing and covers both
        // that and mounting while already in PiP.
        const appStateSubscription = AppState.addEventListener('change', syncFromNative);
        syncFromNative();

        return () => {
            cancelled = true;
            subscription.remove();
            appStateSubscription.remove();
        };
    }, []);

    return isInPip;
}

export default {
    isInPipMode,
    isPipSupported,
    finishCurrentActivity,
    usePipModeListener,
};
