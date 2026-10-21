// @native/HapticModule

import { NativeModules } from 'react-native';

export type UiHaptic =
    | 'tick' | 'segmentTick' | 'confirm' | 'reject' | 'longPress' | 'gestureEnd' | 'toggleOn' | 'toggleOff';

interface HapticModuleInterface {
    /**
     * Vibrates with specified amplitude for a duration
     * @param duration Duration in milliseconds
     * @param amplitude Amplitude from 1-255 (higher = stronger)
     */
    vibrate(duration: number, amplitude: number): void;

    /** System UI haptic; respects the user's touch-feedback setting. */
    perform(type: UiHaptic): void;

    /** A tester's mark on the film's haptics at a media time (haptics layer 5). */
    mark(kind: HapticMark, film: string, positionMs: number): void;
}

export type HapticMark = 'too-much' | 'missed';

const { HapticModule } = NativeModules;

if (!HapticModule) {
    console.error('[HapticModule] Native module not found. Make sure you registered HapticPackage in MainApplication.java');
}

export default HapticModule as HapticModuleInterface;

/** UI feedback haptic. Use per the haptics map: never on routine taps or scrolling. */
export function haptic(type: UiHaptic) {
    HapticModule?.perform?.(type);
}
