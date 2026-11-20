import { create } from 'zustand';
import { VideoFile } from '../types';
import { MediaService } from '../services/MediaService';

/**
 * Search index: every video in the library, from MediaService's single native MediaStore
 * pass. It used to walk each folder by name and diff counts per folder, which merged
 * folders that share a name (two "Camera" folders) and re-synced them on every launch; one
 * flat list has no folder key to collide on.
 */
interface VideoIndexState {
    videos: VideoFile[];
    isIndexing: boolean;
    isIndexReady: boolean;
    /** The last load failed: search offers Retry instead of waiting for ever. */
    indexError: boolean;
    lastFullSyncAt: number | null;

    initialize: () => Promise<void>;
    forceFullSync: () => Promise<void>;
    searchVideos: (query: string) => VideoFile[];
}

let inFlight: Promise<void> | null = null;
// Asked again while a scan runs: that scan may predate a change, so load once more after it.
let dirty = false;

export const useVideoIndexStore = create<VideoIndexState>((set, get) => {
    const load = (forceRefresh: boolean) => {
        if (inFlight) { dirty = true; return inFlight; }
        set({ isIndexing: true, indexError: false });
        inFlight = MediaService.getAllVideos(forceRefresh)
            .then(videos => {
                set({ videos, isIndexReady: true, lastFullSyncAt: Date.now() });
            })
            .catch(error => {
                console.error('[VideoIndexStore] Index error:', error);
                set({ indexError: true });
            })
            .finally(() => {
                inFlight = null;
                set({ isIndexing: false });
                if (dirty) {
                    dirty = false;
                    load(false);
                }
            });
        return inFlight;
    };

    return {
        videos: [],
        isIndexing: false,
        isIndexReady: false,
        indexError: false,
        lastFullSyncAt: null,

        initialize: () => load(false),
        forceFullSync: () => load(true),

        searchVideos: (query: string): VideoFile[] => {
            const q = query.toLowerCase().trim();
            if (!q || !get().isIndexReady) { return []; }
            return get().videos.filter(v => v.name.toLowerCase().includes(q));
        },
    };
});

// Files added or removed, or access granted: an index already built loads again, so search
// is never stuck on the library as it was at launch (empty, if access came later).
MediaService.onChange(() => {
    if (useVideoIndexStore.getState().lastFullSyncAt !== null) {
        useVideoIndexStore.getState().initialize();
    }
});
