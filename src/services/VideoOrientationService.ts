import { NativeModules } from 'react-native';
import { hasNativeApi } from '@/native/GlideNative';
import type { CutoutRect } from '@/utils/cutoutInset';

const { VideoOrientation } = NativeModules;

/**
 * Service to handle video player orientation independently of system settings.
 * Uses custom native module `VideoOrientation`.
 */
export const VideoOrientationService = {
    /**
     * Lock the screen to Portrait mode.
     */
    lockPortrait: () => {
        VideoOrientation.lockToPortrait();
    },

    /**
     * Lock the screen to Landscape mode.
     * Starts strictly as sensor landscape, but locks it.
     */
    lockLandscape: () => {
        VideoOrientation.lockToLandscape();
    },

    /**
     * Enable auto-orientation based on device sensor.
     * This OVERRIDES system auto-rotate settings.
     * The app will rotate even if system auto-rotate is OFF.
     */
    enableAuto: () => {
        VideoOrientation.enableAuto();
    },

    /**
     * Disable auto-orientation detection.
     * Keeps the current orientation locked.
     * Use this when HUD is locked.
     */
    disableAuto: () => {
        VideoOrientation.disableAuto();
    },

    /** Camera cutout rects in dp, window coordinates; null on an APK before API 9. */
    getCutoutRects: async (): Promise<CutoutRect[] | null> => (
        hasNativeApi(9) ? VideoOrientation.getCutoutRects() : null
    ),

    /**
     * The Back gesture's strips at the left/right window edges in dp; null on an APK without
     * the method (any API level after 17 has it).
     */
    getSystemGestureInsets: async (): Promise<{ left: number; right: number } | null> => (
        typeof VideoOrientation?.getSystemGestureInsets === 'function' ? VideoOrientation.getSystemGestureInsets() : null
    ),

    /**
     * Release control and return to system default behavior.
     * Should be called when exiting the video player.
     */
    release: () => {
        VideoOrientation.release();
    },
};
