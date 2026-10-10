import { NativeModules } from 'react-native';

/**
 * The native API level of the APK this bundle is running on.
 *
 * An OTA bundle can land on an APK older than the code it was built from. Before calling
 * any native method, prop, command or event added after level 1, check `hasNativeApi(n)`
 * and fall back when it is false. Levels are listed in GlideNativeModule.kt.
 *
 * An APK from before this module existed reports nothing, and counts as level 1: none of
 * them has anything level 1 lacks.
 */
const native = NativeModules.GlideNative as
    | { apiLevel?: number; versionName?: string; versionCode?: number }
    | undefined;

export const NATIVE_API_LEVEL: number = native?.apiLevel ?? 1;

export function hasNativeApi(level: number): boolean {
    return NATIVE_API_LEVEL >= level;
}
