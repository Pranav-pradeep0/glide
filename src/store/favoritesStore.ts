import { create } from 'zustand';
import { createMMKV } from 'react-native-mmkv';
import { keepCorrupt } from '../storage/keepCorrupt';

const mmkv = createMMKV({ id: 'glide_audio_favorites_v1' });
const FAVORITES_KEY = '@glide_audio_favorites';

function loadInitialFavorites(): string[] {
    try {
        const raw = mmkv.getString(FAVORITES_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        }
    } catch {
        keepCorrupt(mmkv, FAVORITES_KEY);
    }
    return [];
}

function persistFavorites(ids: string[]) {
    try {
        mmkv.set(FAVORITES_KEY, JSON.stringify(ids));
    } catch {
        // ignore
    }
}

// ponytail: Favorites are keyed by Android MediaStore track ID; if the system re-indexes, IDs can drift. Fine for local library, defer custom hashing to later.
interface FavoritesState {
    favoriteIds: string[];
    isFavorite: (id: string) => boolean;
    toggleFavorite: (id: string) => boolean;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
    favoriteIds: loadInitialFavorites(),

    isFavorite: (id: string) => {
        return get().favoriteIds.includes(id);
    },

    toggleFavorite: (id: string) => {
        const { favoriteIds } = get();
        const exists = favoriteIds.includes(id);
        const next = exists ? favoriteIds.filter((item) => item !== id) : [...favoriteIds, id];
        set({ favoriteIds: next });
        persistFavorites(next);
        return !exists;
    },
}));
