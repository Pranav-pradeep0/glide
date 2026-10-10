import { Linking, Permission, PermissionsAndroid, Platform } from 'react-native';

/** What Glide may read: everything, only the videos picked (Android 14+), or nothing. */
export type MediaAccess = 'granted' | 'partial' | 'denied';
export type MediaKind = 'video' | 'audio';

const { PERMISSIONS, RESULTS } = PermissionsAndroid;
/** Android API level; 0 elsewhere, where every check returns granted before reading it. */
const API = Platform.OS === 'android' ? Platform.Version : 0;

/**
 * Checks never prompt; only `request` does, and only when a person asked for access (the
 * grant-access screen). Data services check, so loading a list can never pop a dialog.
 */
class PermissionServiceClass {
    private readPermission(kind: MediaKind): Permission {
        if (API < 33) {
            return PERMISSIONS.READ_EXTERNAL_STORAGE;
        }
        return kind === 'video' ? PERMISSIONS.READ_MEDIA_VIDEO : PERMISSIONS.READ_MEDIA_AUDIO;
    }

    async check(kind: MediaKind): Promise<MediaAccess> {
        if (Platform.OS !== 'android') {
            return 'granted';
        }
        try {
            if (await PermissionsAndroid.check(this.readPermission(kind))) {
                return 'granted';
            }
            // Android 14+ "Select videos": the full permission reads as denied, the
            // user-selected one as granted, and MediaStore returns only the chosen files.
            if (kind === 'video' && API >= 34
                && await PermissionsAndroid.check(PERMISSIONS.READ_MEDIA_VISUAL_USER_SELECTED)) {
                return 'partial';
            }
            return 'denied';
        } catch (error) {
            console.error('[PermissionService] Permission check failed:', error);
            return 'denied';
        }
    }

    /**
     * Ask for access. On Android 14+ video asks with the partial permission too, which is
     * what makes the system offer "Select videos" and lets a partial grant be re-asked to
     * pick more. `blocked` means Android will not show the dialog again ("Don't allow"
     * twice); the caller sends the person to Settings.
     */
    async request(kind: MediaKind): Promise<{ access: MediaAccess; blocked: boolean }> {
        if (Platform.OS !== 'android') {
            return { access: 'granted', blocked: false };
        }
        const primary = this.readPermission(kind);
        const permissions = kind === 'video' && API >= 34
            ? [primary, PERMISSIONS.READ_MEDIA_VISUAL_USER_SELECTED]
            : [primary];
        try {
            const results = await PermissionsAndroid.requestMultiple(permissions);
            const access = await this.check(kind);
            const blocked = access === 'denied' && results[primary] === RESULTS.NEVER_ASK_AGAIN;
            return { access, blocked };
        } catch (error) {
            console.error('[PermissionService] Permission request failed:', error);
            return { access: 'denied', blocked: false };
        }
    }

    openSettings() {
        Linking.openSettings().catch(() => {});
    }

    /**
     * Android 9 and below delete media through the storage write permission (the manifest
     * caps it at API 28). From Android 10 the system asks per file instead, so this is true.
     */
    async requestDeletePermission(): Promise<boolean> {
        if (Platform.OS !== 'android' || API >= 29) {
            return true;
        }
        try {
            const status = await PermissionsAndroid.request(PERMISSIONS.WRITE_EXTERNAL_STORAGE);
            if (status === RESULTS.NEVER_ASK_AGAIN) {
                this.openSettings();
            }
            return status === RESULTS.GRANTED;
        } catch (error) {
            console.error('[PermissionService] Delete permission request failed:', error);
            return false;
        }
    }

    /** True when audio can be read. Kept for the callers that only need a yes or no. */
    async checkAudioPermission(): Promise<boolean> {
        return (await this.check('audio')) === 'granted';
    }
}

export const PermissionService = new PermissionServiceClass();
