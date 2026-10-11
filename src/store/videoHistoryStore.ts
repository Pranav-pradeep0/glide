import { create } from 'zustand';
import { createMMKV } from 'react-native-mmkv';
import { VideoHistoryEntry, VideoBookmark } from '../types';

const mmkv = createMMKV({ id: 'video_history_v1' });
const HISTORY_KEY = '@video_history_v1';

/**
 * Generate a canonical video ID from name and optional file size.
 * This allows matching the same video opened from different sources
 * (e.g., content:// URI vs file:// path).
 */
export function generateVideoId(videoName: string, fileSize?: number): string {
    const normalizedName = videoName.toLowerCase().trim();
    if (fileSize && fileSize > 0) {
        return `${normalizedName}::${fileSize}`;
    }
    return normalizedName;
}

interface VideoHistoryState {
    history: Map<string, VideoHistoryEntry>;
    isHydrated: boolean;

    // Actions
    getVideoHistory: (videoPath: string) => VideoHistoryEntry | null;
    getVideoHistoryByName: (videoName: string) => VideoHistoryEntry | null;
    getAllHistory: () => VideoHistoryEntry[];
    updateVideoHistory: (entry: Partial<VideoHistoryEntry> & { videoPath: string; videoName: string }) => void;
    incrementViewCount: (videoPath: string, videoName: string, contentUri?: string, fileSize?: number) => void;
    updatePlaybackPosition: (videoPath: string, videoName: string, position: number, duration: number, audioTrackId?: number, subtitleTrackIndex?: number, audioDelay?: number, subtitleDelay?: number, brightness?: number, fileSize?: number) => void;
    setStopFrame: (videoPath: string, videoName: string, stopFrameMs: number | undefined) => void;
    addBookmark: (videoPath: string, videoName: string, timestamp: number, label?: string) => void;
    removeBookmark: (videoPath: string, bookmarkId: string) => void;
    updateBookmarkLabel: (videoPath: string, bookmarkId: string, label: string) => void;
    clearVideoHistory: (videoPath: string) => void;
    clearAllHistory: () => void;

    // Persistence
    hydrateFromStorage: () => Promise<void>;
    persistToStorage: () => void;
    persistNow: () => void;
}

/**
 * Every entry is rewritten on every save, so the whole file is the cost of one position
 * update. Nothing ever removed an entry, so a year of watching turned a 2 ms write into a
 * visible one. Oldest first, and anything with a bookmark stays however old it is: a
 * bookmark is something the user made, a resume position is not.
 */
const MAX_HISTORY_ENTRIES = 500;

export function prune(history: Map<string, VideoHistoryEntry>): VideoHistoryEntry[] {
    const all = Array.from(history.values());
    if (all.length <= MAX_HISTORY_ENTRIES) {return all;}

    const kept = all.filter((e) => (e.bookmarks?.length ?? 0) > 0);
    const rest = all
        .filter((e) => !e.bookmarks?.length)
        .sort((a, b) => b.lastWatchedTime - a.lastWatchedTime)
        .slice(0, Math.max(0, MAX_HISTORY_ENTRIES - kept.length));
    return [...kept, ...rest];
}

// Batch persistence to reduce writes
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistRaf: number | null = null;

function debouncedPersist() {
    if (persistTimer) {clearTimeout(persistTimer);}
    if (persistRaf) {cancelAnimationFrame(persistRaf);}

    // Use RAF for immediate feedback, timeout for actual write
    persistRaf = requestAnimationFrame(() => {
        persistRaf = null;
    });

    persistTimer = setTimeout(() => {
        useVideoHistoryStore.getState().persistToStorage();
        persistTimer = null;
    }, 500);
}

// Synchronous Initialization
// Load history immediately when the file is imported (App start)
// effectively eliminating the "loading" state
let initialHistory = new Map<string, VideoHistoryEntry>();
try {
    const cached = mmkv.getString(HISTORY_KEY);
    if (cached) {
        const data = JSON.parse(cached) as VideoHistoryEntry[];
        initialHistory = new Map(data.map((entry) => [entry.videoPath, entry]));
    }
} catch (error) {
    console.error('[VideoHistoryStore] Sync init error:', error);
}

/**
 * Find an entry matching by exact path first, then by contentUri.
 * Only falls back to videoId when the path is not a local file path.
 */
function findHistoryEntry(
    history: Map<string, VideoHistoryEntry>,
    videoPath: string,
    videoId?: string
): { key: string; entry: VideoHistoryEntry } | null {
    // 1. Direct key match by videoPath
    if (history.has(videoPath)) {
        return { key: videoPath, entry: history.get(videoPath)! };
    }

    // 2. Scan by videoPath or contentUri
    for (const [key, entry] of history.entries()) {
        if (entry.videoPath === videoPath || (entry.contentUri && entry.contentUri === videoPath)) {
            return { key, entry };
        }
    }

    // 3. Fallback: match by videoId only for non-local paths (content://, http(s)://)
    const isLocalFile = videoPath.startsWith('file://') || videoPath.startsWith('/');
    if (!isLocalFile && videoId) {
        for (const [key, entry] of history.entries()) {
            if (entry.videoId === videoId) {
                return { key, entry };
            }
        }
    }

    return null;
}

export const useVideoHistoryStore = create<VideoHistoryState>((set, get) => ({
    history: initialHistory,
    isHydrated: true, // Always hydrated now

    getVideoHistory: (videoPath: string) => {
        const videoId = generateVideoId(videoPath.split('/').pop() || videoPath);
        return findHistoryEntry(get().history, videoPath, videoId)?.entry ?? null;
    },

    getVideoHistoryByName: (videoName: string) => {
        const videoId = generateVideoId(videoName);
        for (const entry of get().history.values()) {
            if (entry.videoId === videoId) {
                return entry;
            }
        }
        return null;
    },

    getAllHistory: () => {
        const historyMap = get().history;
        return Array.from(historyMap.values())
            .filter(entry => !entry.hideFromRecents) // Hide content:// and http(s):// entries
            .sort((a, b) => b.lastWatchedTime - a.lastWatchedTime);
    },

    updateVideoHistory: (entry) => {
        const { videoPath, videoName, ...updates } = entry;
        const videoId = generateVideoId(videoName);

        set((state) => {
            const newHistory = new Map(state.history);

            const match = findHistoryEntry(newHistory, videoPath, videoId);
            const existingKey = match?.key;
            const existing = match?.entry;

            if (existing && existingKey) {
                // Update existing entry, but keep the original key
                newHistory.set(existingKey, {
                    ...existing,
                    ...updates,
                    videoPath: existing.videoPath, // Keep original path for file operations
                    videoName,
                    videoId,
                    lastWatchedTime: Date.now(),
                });
            } else {
                newHistory.set(videoPath, {
                    videoPath,
                    videoName,
                    videoId,
                    lastWatchedTime: Date.now(),
                    lastPausedPosition: 0,
                    duration: 0,
                    viewCount: 0,
                    bookmarks: [],
                    ...updates,
                });
            }

            return { history: newHistory };
        });
        debouncedPersist();
    },

    incrementViewCount: (videoPath: string, videoName: string, contentUri?: string, fileSize?: number) => {
        // Skip content:// and http/https URIs from appearing in history list
        // These can't be reliably replayed (permissions expire, URLs expire)
        // Note: updatePlaybackPosition still saves their state for resume when reopened
        const isNonReplayable = videoPath.startsWith('content://') ||
            videoPath.startsWith('http://') ||
            videoPath.startsWith('https://');
        if (isNonReplayable) {
            return;
        }

        const videoId = generateVideoId(videoName, fileSize);

        set((state) => {
            const newHistory = new Map(state.history);

            const match = findHistoryEntry(newHistory, videoPath, videoId);
            const existingKey = match?.key;
            const existing = match?.entry;

            if (existing && existingKey) {
                newHistory.set(existingKey, {
                    ...existing,
                    viewCount: existing.viewCount + 1,
                    lastWatchedTime: Date.now(),
                    contentUri: contentUri || existing.contentUri,
                    // Keep the best path: prefer file:// over content:// or http(s)://
                    videoPath: videoPath.startsWith('file://') || videoPath.startsWith('/')
                        ? videoPath
                        : existing.videoPath,
                });
            } else {
                // Use videoId as key for non-file:// URIs (content://, http://, etc.)
                const isLocalFile = videoPath.startsWith('file://') || videoPath.startsWith('/');
                const key = isLocalFile ? videoPath : videoId;
                newHistory.set(key, {
                    videoPath,
                    videoName,
                    videoId,
                    contentUri,
                    lastWatchedTime: Date.now(),
                    lastPausedPosition: 0,
                    duration: 0,
                    viewCount: 1,
                    bookmarks: [],
                });
            }

            return { history: newHistory };
        });
        debouncedPersist();
    },

    updatePlaybackPosition: (videoPath, videoName, position, duration, audioTrackId, subtitleTrackIndex, audioDelay, subtitleDelay, brightness, fileSize) => {
        const videoId = generateVideoId(videoName, fileSize);

        set((state) => {
            const newHistory = new Map(state.history);

            const match = findHistoryEntry(newHistory, videoPath, videoId);
            const existingKey = match?.key;
            const existing = match?.entry;

            if (existing && existingKey) {
                newHistory.set(existingKey, {
                    ...existing,
                    lastPausedPosition: position,
                    duration: duration,
                    lastWatchedTime: Date.now(),
                    selectedAudioTrackId: audioTrackId,
                    selectedSubtitleTrackId: subtitleTrackIndex,
                    audioDelay: audioDelay,
                    subtitleDelay: subtitleDelay,
                    brightness: brightness,
                    // Keep the best path: prefer file:// over content:// or http(s)://
                    videoPath: videoPath.startsWith('file://') || videoPath.startsWith('/')
                        ? videoPath
                        : existing.videoPath,
                });
            } else {
                // Create new entry
                // Mark non-local files (content://, http(s)://) as hidden from Recents
                // but still save their playback state for resume functionality
                const isLocalFile = videoPath.startsWith('file://') || videoPath.startsWith('/');
                const key = isLocalFile ? videoPath : videoId;

                newHistory.set(key, {
                    videoPath,
                    videoName,
                    videoId,
                    hideFromRecents: !isLocalFile, // Hide content:// and http(s):// from Recents
                    lastWatchedTime: Date.now(),
                    lastPausedPosition: position,
                    duration: duration,
                    viewCount: 0,
                    bookmarks: [],
                    selectedAudioTrackId: audioTrackId,
                    selectedSubtitleTrackId: subtitleTrackIndex,
                    audioDelay: audioDelay,
                    subtitleDelay: subtitleDelay,
                    brightness: brightness,
                });
            }

            return { history: newHistory };
        });
        debouncedPersist();
    },

    setStopFrame: (videoPath, videoName, stopFrameMs) => {
        set((state) => {
            const match = findHistoryEntry(state.history, videoPath, generateVideoId(videoName));
            if (!match || match.entry.stopFrameMs === stopFrameMs) {return state;}
            const newHistory = new Map(state.history);
            newHistory.set(match.key, { ...match.entry, stopFrameMs });
            return { history: newHistory };
        });
        debouncedPersist();
    },

    addBookmark: (videoPath: string, videoName: string, timestamp: number, label?: string) => {
        const videoId = generateVideoId(videoName);

        set((state) => {
            const newHistory = new Map(state.history);

            const match = findHistoryEntry(newHistory, videoPath, videoId);
            const existingKey = match?.key;
            const existing = match?.entry;

            const newBookmark: VideoBookmark = {
                id: `${videoId}-${timestamp}-${Date.now()}`,
                timestamp,
                createdAt: Date.now(),
                label,
            };

            if (existing && existingKey) {
                // Check for duplicate bookmark (within 2 seconds)
                const isDuplicate = existing.bookmarks.some(
                    b => Math.abs(b.timestamp - timestamp) < 2
                );

                if (isDuplicate) {
                    console.warn('[VideoHistoryStore] Duplicate bookmark detected, skipping');
                    return state;
                }

                newHistory.set(existingKey, {
                    ...existing,
                    bookmarks: [...existing.bookmarks, newBookmark].sort((a, b) => a.timestamp - b.timestamp),
                });
            } else {
                // Create new entry for bookmark
                const isLocalFile = videoPath.startsWith('file://') || videoPath.startsWith('/');
                const key = isLocalFile ? videoPath : videoId;

                newHistory.set(key, {
                    videoPath,
                    videoName,
                    videoId,
                    hideFromRecents: !isLocalFile,
                    lastWatchedTime: Date.now(),
                    lastPausedPosition: 0,
                    duration: 0,
                    viewCount: 0,
                    bookmarks: [newBookmark],
                });
            }

            return { history: newHistory };
        });

        // Immediate persist for bookmarks
        get().persistNow();
    },

    removeBookmark: (videoPath: string, bookmarkId: string) => {
        set((state) => {
            const newHistory = new Map(state.history);

            const videoId = generateVideoId(videoPath.split('/').pop() || videoPath);
            const match = findHistoryEntry(newHistory, videoPath, videoId);
            const existingKey = match?.key;
            const existing = match?.entry;

            if (existing && existingKey) {
                newHistory.set(existingKey, {
                    ...existing,
                    bookmarks: existing.bookmarks.filter((b) => b.id !== bookmarkId),
                });
            }

            return { history: newHistory };
        });

        // Immediate persist for bookmark deletion
        get().persistNow();
    },

    updateBookmarkLabel: (videoPath: string, bookmarkId: string, label: string) => {
        set((state) => {
            const newHistory = new Map(state.history);

            const videoId = generateVideoId(videoPath.split('/').pop() || videoPath);
            const match = findHistoryEntry(newHistory, videoPath, videoId);
            const existingKey = match?.key;
            const existing = match?.entry;

            if (existing && existingKey) {
                newHistory.set(existingKey, {
                    ...existing,
                    bookmarks: existing.bookmarks.map((b) =>
                        b.id === bookmarkId ? { ...b, label } : b
                    ),
                });
            }

            return { history: newHistory };
        });
        debouncedPersist();
    },

    clearVideoHistory: (videoPath: string) => {
        set((state) => {
            const newHistory = new Map(state.history);

            const videoId = generateVideoId(videoPath.split('/').pop() || videoPath);
            const match = findHistoryEntry(newHistory, videoPath, videoId);
            if (match) {
                newHistory.delete(match.key);
            }

            return { history: newHistory };
        });
        debouncedPersist();
    },

    clearAllHistory: () => {
        set({ history: new Map() });
        mmkv.remove(HISTORY_KEY);
    },

    // Deprecated: No longer needed with sync initialization
    hydrateFromStorage: async () => { },

    persistToStorage: () => {
        try {
            const state = get();
            mmkv.set(HISTORY_KEY, JSON.stringify(prune(state.history)));
        } catch (error) {
            console.error('[VideoHistoryStore] Persist error:', error);
        }
    },

    persistNow: () => {
        // Clear pending debounce timers
        if (persistTimer) {clearTimeout(persistTimer);}
        if (persistRaf) {cancelAnimationFrame(persistRaf);}
        persistTimer = null;
        persistRaf = null;

        // Force synchronous save
        get().persistToStorage();
    },
}));
