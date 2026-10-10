import { Linking, PermissionsAndroid, Platform } from 'react-native';

class PermissionServiceClass {
    /**
     * Check and request the video permission Glide actually reads on Android.
     * Returns true if it is granted or not required (iOS).
     */
    async hasAndroidPermission(): Promise<boolean> {
        if (Platform.OS !== 'android') {
            return true;
        }

        try {
            // Android 13+ (API 33+) uses granular media permissions. Glide reads only
            // videos, so it must not ask for images or audio to get at them.
            //
            // On Android 14+ "Select videos" grants partial access. Glide does not
            // declare READ_MEDIA_VISUAL_USER_SELECTED and so runs in compatibility
            // mode: the grant reads as granted but covers only the chosen videos, and
            // the picker reappears on a later launch. Declaring it would mean owning
            // re-selection UI, which is not worth it until users ask.
            if (Platform.Version >= 33) {
                const status = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO
                );
                return status === PermissionsAndroid.RESULTS.GRANTED;
            }

            // Android 12 and below use READ_EXTERNAL_STORAGE
            const status = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
            );
            return status === PermissionsAndroid.RESULTS.GRANTED;
        } catch (error) {
            console.error('[PermissionService] Permission request failed:', error);
            return false;
        }
    }

    /**
     * Android 9 and below delete media through the storage write permission (the manifest
     * caps it at API 28). From Android 10 the system asks per file instead, so this is true.
     */
    async requestDeletePermission(): Promise<boolean> {
        if (Platform.OS !== 'android' || Platform.Version >= 29) {
            return true;
        }
        try {
            const status = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
            if (status === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
                await Linking.openSettings().catch(() => {});
            }
            return status === PermissionsAndroid.RESULTS.GRANTED;
        } catch (error) {
            console.error('[PermissionService] Delete permission request failed:', error);
            return false;
        }
    }

    /**
     * Check if audio permission is granted without prompting.
     */
    async checkAudioPermission(): Promise<boolean> {
        if (Platform.OS !== 'android') {
            return true;
        }
        try {
            if (Platform.Version >= 33) {
                return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO);
            }
            return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
        } catch (error) {
            console.error('[PermissionService] Permission check failed:', error);
            return false;
        }
    }

    /**
     * Request the audio permission Glide needs to scan songs on Android.
     */
    async requestAudioPermission(): Promise<boolean> {
        if (Platform.OS !== 'android') {
            return true;
        }
        try {
            const perm =
                Platform.Version >= 33
                    ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO
                    : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
            const status = await PermissionsAndroid.request(perm);
            if (status === PermissionsAndroid.RESULTS.GRANTED) {
                return true;
            }
            if (status === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
                try {
                    await Linking.openSettings();
                } catch {
                    // ignore
                }
            }
            return false;
        } catch (error) {
            console.error('[PermissionService] Audio permission request failed:', error);
            return false;
        }
    }
}

export const PermissionService = new PermissionServiceClass();
