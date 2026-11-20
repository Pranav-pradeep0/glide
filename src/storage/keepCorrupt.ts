import type { MMKV } from 'react-native-mmkv';

/**
 * A saved value that won't parse is copied to `${key}.corrupt` first, so the next save, which
 * starts from empty, doesn't destroy the only copy.
 */
export function keepCorrupt(store: MMKV, key: string): void {
    try {
        const raw = store.getString(key);
        if (raw !== undefined) {
            store.set(`${key}.corrupt`, raw);
        }
    } catch {
        // Nothing more to save
    }
}
