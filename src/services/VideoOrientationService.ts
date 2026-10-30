import { NativeModules } from 'react-native';
import type { CutoutRect } from '@/utils/cutoutInset';

const { VideoOrientation } = NativeModules;

/**
 * Service to handle video player orientation independently of system settings.
 * Uses custom native module `VideoOrientation`.
 */
export const VideoOrientationService = {
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

    /** Camera cutout rects in dp, window coordinates. */
    getCutoutRects: async (): Promise<CutoutRect[] | null> => VideoOrientation.getCutoutRects(),

    /** The Back gesture's strips at the left/right window edges in dp. */
    getSystemGestureInsets: async (): Promise<{ left: number; right: number } | null> => (
        VideoOrientation.getSystemGestureInsets()
    ),

    /**
     * Release control and return to system default behavior.
     * Should be called when exiting the video player.
     */
    release: () => {
        VideoOrientation.release();
    },
};
