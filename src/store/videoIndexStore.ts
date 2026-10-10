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
    lastFullSyncAt: number | null;

    initialize: () => Promise<void>;
    forceFullSync: () => Promise<void>;
    searchVideos: (query: string) => VideoFile[];
}

let inFlight: Promise<void> | null = null;

export const useVideoIndexStore = create<VideoIndexState>((set, get) => {
    const load = (forceRefresh: boolean) => {
        if (inFlight) { return inFlight; }
        set({ isIndexing: true });
        inFlight = MediaService.getAllVideos(forceRefresh)
            .then(videos => {
                set({ videos, isIndexReady: true, lastFullSyncAt: Date.now() });
            })
            .catch(error => {
                console.error('[VideoIndexStore] Index error:', error);
            })
            .finally(() => {
                inFlight = null;
                set({ isIndexing: false });
            });
        return inFlight;
    };

    return {
        videos: [],
        isIndexing: false,
        isIndexReady: false,
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
