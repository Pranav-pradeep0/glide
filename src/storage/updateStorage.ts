import { createMMKV } from 'react-native-mmkv';

export type UpdateApkCache = {
    version: string;
    path: string;
    fileName: string;
    savedAt: number;
};

const UPDATE_APK_KEY = '@glide_update_apk';
const NOTIFIED_VERSION_KEY = '@glide_update_notified_version';

const mmkv = createMMKV({
    id: UPDATE_APK_KEY,
});

// MMKV is synchronous. These were Promise-returning, which made callers await work that
// had already finished and implied a backend that could fail asynchronously.
export const updateStorage = {
    load(): UpdateApkCache | null {
        try {
            const raw = mmkv.getString(UPDATE_APK_KEY);
            if (!raw) {return null;}
            const parsed = JSON.parse(raw) as UpdateApkCache;
            if (!parsed?.path || !parsed?.version || !parsed?.fileName) {
                return null;
            }
            return parsed;
        } catch (error) {
            console.error('[UpdateStorage] Failed to load cache:', error);
            return null;
        }
    },

    save(cache: UpdateApkCache): void {
        try {
            mmkv.set(UPDATE_APK_KEY, JSON.stringify(cache));
        } catch (error) {
            console.error('[UpdateStorage] Failed to save cache:', error);
        }
    },

    /** The version the user was last told about, so each release is announced once. */
    notifiedVersion(): string | null {
        return mmkv.getString(NOTIFIED_VERSION_KEY) ?? null;
    },

    setNotifiedVersion(version: string): void {
        mmkv.set(NOTIFIED_VERSION_KEY, version);
    },

    clear(): void {
        try {
            mmkv.remove(UPDATE_APK_KEY);
        } catch (error) {
            console.error('[UpdateStorage] Failed to clear cache:', error);
        }
    },
};
