import { NativeModules } from 'react-native';

/** Build info from GlideNativeModule.kt. */
const native = NativeModules.GlideNative as
    | {
          apiLevel?: number;
          versionName?: string;
          versionCode?: number;
          env?: string;
          setCrashReportsEnabled: (enabled: boolean) => void;
      }
    | undefined;

/** The APK's native API level, shown in Settings > Version. */
export const NATIVE_API_LEVEL: number = native?.apiLevel ?? 1;

/**
 * Build-time strings from .env (API keys, endpoints), baked into the APK by
 * android/app/build.gradle.
 */
export const BUILD_ENV: Partial<Record<string, string>> = JSON.parse(native?.env ?? '{}');

/** Turns ACRA's crash dialog on or off (android/.../CrashReports.kt). */
export function setCrashReportsEnabled(enabled: boolean): void {
    native?.setCrashReportsEnabled(enabled);
}
