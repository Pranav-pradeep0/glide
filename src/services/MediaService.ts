import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { hasNativeApi } from '@/native/GlideNative';
import { PermissionService } from './PermissionService';
import { VideoFile, VideoFolder } from '@/types';

export interface MediaLibraryResult {
    videos: VideoFile[];
    folders: VideoFolder[];
}

export interface VideoEdge {
    name: string;
    path: string;
    uri: string;
    duration: number;
    size: number;
    width?: number;
    height?: number;
    timestamp: number;
}

export interface VideoPageResult {
    edges: VideoEdge[];
    page_info: {
        has_next_page: boolean;
        end_cursor?: string | null;
    };
}

class MediaServiceClass {
    private libraryCache: MediaLibraryResult | null = null;
    private libraryCacheTimestamp = 0;
    /** The scan currently running, shared by everyone who asks while it is in flight. */
    private inflightLibrary: Promise<MediaLibraryResult> | null = null;
    private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

    private get module() {
        return NativeModules.MediaStoreVideoModule;
    }

    invalidateCache() {
        this.libraryCache = null;
        this.libraryCacheTimestamp = 0;
        // A scan already running may have read the library before the change.
        this.inflightLibrary = null;
    }

    invalidateVideosCache(_albumName?: string | null) {
        this.invalidateCache();
    }

    /**
     * Delete videos by content:// URI, file:// URI or path (native resolves paths to their
     * MediaStore entry). Android 11+ shows the system's confirmation dialog.
     *
     * True when deleted, false when the user cancelled. Throws on failure, with
     * `code: 'E_PERMISSION'` when Android 9 or below was refused the storage permission.
     */
    async deleteVideos(targets: string[]): Promise<boolean> {
        if (Platform.OS !== 'android' || !this.module?.deleteVideos) {
            return false;
        }
        if (!(await PermissionService.requestDeletePermission())) {
            throw Object.assign(new Error('Storage permission denied'), { code: 'E_PERMISSION' });
        }
        const deleted = (await this.module.deleteVideos(targets)) === true;
        if (deleted) {
            this.invalidateCache();
        }
        return deleted;
    }

    /**
     * Scan the device media library once in a single native pass,
     * returning all videos and pre-aggregated folder buckets.
     */
    async getLibrary(forceRefresh = false): Promise<MediaLibraryResult> {
        if (Platform.OS !== 'android' || !this.module) {
            return { videos: [], folders: [] };
        }

        const hasPermission = await PermissionService.hasAndroidPermission();
        if (!hasPermission) {
            console.warn('[MediaService] No permission to access media');
            return { videos: [], folders: [] };
        }

        const now = Date.now();
        if (!forceRefresh && this.libraryCache && (now - this.libraryCacheTimestamp < MediaServiceClass.CACHE_TTL_MS)) {
            return this.libraryCache;
        }

        // Screens mount together and each asks for the library, all before the first
        // answer lands, so the TTL cache is still empty and every one of them used to run
        // its own full MediaStore scan. They share this one instead. A forced refresh does
        // not join: it exists because the scan already running may predate a change.
        if (!forceRefresh && this.inflightLibrary) {
            return this.inflightLibrary;
        }

        // Started from a resolved promise, so even a synchronous throw from the native call
        // lands in .catch after `scan` is assigned, never before it.
        const scan: Promise<MediaLibraryResult> = Promise.resolve()
            .then(() => this.module.getLibrary())
            .then((result) => {
                const data: MediaLibraryResult = {
                    videos: (result?.videos || []) as VideoFile[],
                    folders: (result?.folders || []) as VideoFolder[],
                };
                // Superseded by a forced refresh or an invalidation while it ran: its
                // answer may be the stale one, so it must not become the cache.
                if (this.inflightLibrary === scan) {
                    this.libraryCache = data;
                    this.libraryCacheTimestamp = Date.now();
                }
                return data;
            })
            .catch((error) => {
                console.error('[MediaService] Failed to load library:', error);
                return this.libraryCache ?? { videos: [], folders: [] };
            })
            .finally(() => {
                if (this.inflightLibrary === scan) {
                    this.inflightLibrary = null;
                }
            });
        this.inflightLibrary = scan;
        return scan;
    }

    /**
     * Get all folders that contain videos, pre-aggregated with counts and cover video paths.
     */
    async getFolders(forceRefresh = false): Promise<VideoFolder[]> {
        const library = await this.getLibrary(forceRefresh);
        return library.folders;
    }

    /**
     * Get all albums (folders). Kept for backward compatibility.
     */
    async getAlbums(forceRefresh = false): Promise<VideoFolder[]> {
        return this.getFolders(forceRefresh);
    }

    /**
     * Get all videos in the library.
     */
    async getAllVideos(forceRefresh = false): Promise<VideoFile[]> {
        const library = await this.getLibrary(forceRefresh);
        return library.videos;
    }

    /**
     * Get videos belonging to a specific album/folder.
     */
    async getVideosByAlbum(albumTitle: string, forceRefresh = false, bucketId?: string): Promise<VideoFile[]> {
        if (Platform.OS !== 'android' || !this.module) {
            return [];
        }

        const hasPermission = await PermissionService.hasAndroidPermission();
        if (!hasPermission) {
            return [];
        }

        const filterFn = (v: VideoFile) => {
            if (bucketId && v.bucketId) {
                return v.bucketId === bucketId;
            }
            return v.album === albumTitle || v.bucketId === albumTitle;
        };

        if (!forceRefresh && this.libraryCache) {
            return this.libraryCache.videos.filter(filterFn);
        }

        try {
            if (typeof this.module.getVideos === 'function') {
                const queryId = bucketId || albumTitle;
                const videos = await this.module.getVideos(queryId);
                return (videos || []) as VideoFile[];
            }
        } catch (error) {
            console.warn('[MediaService] Failed to getVideos for bucket:', albumTitle, error);
        }

        const library = await this.getLibrary(forceRefresh);
        return library.videos.filter(filterFn);
    }

    /**
     * Paginated videos query compatible with CameraRoll pagination format.
     */
    async getVideos(
        albumName: string | null,
        limit = 50,
        after?: string,
        forceRefresh = false
    ): Promise<VideoPageResult> {
        const hasPermission = await PermissionService.hasAndroidPermission();
        if (!hasPermission) {
            return { edges: [], page_info: { has_next_page: false } };
        }

        const allVideos = albumName
            ? await this.getVideosByAlbum(albumName, forceRefresh)
            : (await this.getLibrary(forceRefresh)).videos;

        const offset = after ? parseInt(after, 10) : 0;
        const paged = allVideos.slice(offset, offset + limit);
        const hasNext = offset + limit < allVideos.length;
        const endCursor = hasNext ? (offset + limit).toString() : null;

        return {
            edges: paged.map(v => ({
                name: v.name,
                path: v.path,
                uri: v.uri || v.path,
                duration: v.duration,
                size: v.size,
                width: v.width,
                height: v.height,
                timestamp: Math.floor(v.modifiedDate / 1000),
            })),
            page_info: {
                has_next_page: hasNext,
                end_cursor: endCursor,
            },
        };
    }

    /**
     * Request a fast system-cached video thumbnail from MediaStore.
     */
    async getThumbnail(
        videoUriOrPath: string,
        width?: number,
        height?: number
    ): Promise<string | null> {
        if (Platform.OS !== 'android' || !this.module || !videoUriOrPath) {
            return null;
        }

        try {
            if (width !== undefined && height !== undefined && typeof this.module.getThumbnailWithSize === 'function') {
                return await this.module.getThumbnailWithSize(videoUriOrPath, width, height);
            }
            if (typeof this.module.getThumbnail === 'function') {
                return await this.module.getThumbnail(videoUriOrPath);
            }
            return null;
        } catch {
            return null;
        }
    }
}

export const MediaService = new MediaServiceClass();

// A video added or removed outside Glide (API 2). Older APKs keep the 5-minute cache TTL.
if (Platform.OS === 'android' && hasNativeApi(2)) {
    DeviceEventEmitter.addListener('onVideoLibraryChanged', () => MediaService.invalidateCache());
}
