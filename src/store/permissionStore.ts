import { AppState } from 'react-native';
import { create } from 'zustand';
import { createMMKV } from 'react-native-mmkv';
import { MediaAccess, MediaKind, PermissionService } from '@/services/PermissionService';
import { MediaService } from '@/services/MediaService';
import { AudioMediaService } from '@/services/AudioMediaService';

/**
 * Whether Glide can read videos and music, kept current for every screen.
 *
 * Re-checked whenever the app comes back to the front, which is how a grant made in
 * Settings (or a revoke) reaches the screens. When access changes, the matching library
 * cache is dropped, so lists load what is now readable.
 */
interface KindState {
    /** `unknown` until the first check. */
    access: MediaAccess | 'unknown';
    /** Android will not show the dialog again: the only way left is Settings. */
    blocked: boolean;
}

interface PermissionState {
    video: KindState;
    audio: KindState;
    refresh: () => Promise<void>;
    /** From a grant-access button: shows the system dialog, or opens Settings when blocked. */
    request: (kind: MediaKind) => Promise<void>;
}

// "Blocked" survives a restart: Android gives no way to read it back, and without it the
// first tap after a relaunch would silently do nothing.
const prefs = createMMKV({ id: 'glide_permissions' });
const blockedKey = (kind: MediaKind) => `blocked_${kind}`;

function libraryChanged(kind: MediaKind) {
    if (kind === 'video') {
        MediaService.notifyChanged();
    } else {
        AudioMediaService.invalidateCache();
    }
}

export const usePermissionStore = create<PermissionState>((set, get) => {
    /** Returns whether anything changed; a change drops that library's cache. */
    const apply = (kind: MediaKind, access: MediaAccess, blocked: boolean): boolean => {
        const before = get()[kind];
        if (access !== 'denied') {
            blocked = false;
        }
        prefs.set(blockedKey(kind), blocked);
        if (before.access === access && before.blocked === blocked) {
            return false;
        }
        set({ [kind]: { access, blocked } } as Pick<PermissionState, MediaKind>);
        // The first check is the starting point, not a change.
        if (before.access !== 'unknown') {
            libraryChanged(kind);
        }
        return true;
    };

    return {
        video: { access: 'unknown', blocked: prefs.getBoolean(blockedKey('video')) ?? false },
        audio: { access: 'unknown', blocked: prefs.getBoolean(blockedKey('audio')) ?? false },

        refresh: async () => {
            const [video, audio] = await Promise.all([
                PermissionService.check('video'),
                PermissionService.check('audio'),
            ]);
            apply('video', video, get().video.blocked);
            apply('audio', audio, get().audio.blocked);
        },

        request: async (kind) => {
            if (get()[kind].blocked) {
                PermissionService.openSettings();
                return;
            }
            const { access, blocked } = await PermissionService.request(kind);
            // Picking a different set of videos (Android 14+) leaves access at partial, but
            // what is readable changed, so the library reloads all the same.
            if (!apply(kind, access, blocked) && access !== 'denied') {
                libraryChanged(kind);
            }
        },
    };
});

usePermissionStore.getState().refresh();
AppState.addEventListener('change', (state) => {
    if (state === 'active') {
        usePermissionStore.getState().refresh();
    }
});
