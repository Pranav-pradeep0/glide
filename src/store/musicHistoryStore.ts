import { create } from 'zustand';
import { createMMKV } from 'react-native-mmkv';

const mmkv = createMMKV({ id: 'glide_music_history_v1' });
const HISTORY_KEY = '@glide_music_history';
const MAX_ENTRIES = 50;

interface MusicHistoryEntry {
    /** The song's id: its MediaStore id for library songs. */
    id: string;
    playedAt: number;
}

function loadHistory(): MusicHistoryEntry[] {
    try {
        const raw = mmkv.getString(HISTORY_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

interface MusicHistoryState {
    /** Newest first; each song appears once, at its latest play. */
    entries: MusicHistoryEntry[];
    recordPlay: (id: string) => void;
}

/**
 * Recently played songs, for Recents > Music. Stores ids only and resolves them against the
 * library when shown, so a song deleted from the device simply drops out of the list.
 */
export const useMusicHistoryStore = create<MusicHistoryState>((set, get) => ({
    entries: loadHistory(),

    recordPlay: (id: string) => {
        const entries = [{ id, playedAt: Date.now() }, ...get().entries.filter((e) => e.id !== id)].slice(
            0,
            MAX_ENTRIES
        );
        set({ entries });
        try {
            mmkv.set(HISTORY_KEY, JSON.stringify(entries));
        } catch {
            // ignore
        }
    },
}));
