import { useState, useEffect, useCallback } from 'react';
import { MediaService } from '@/services/MediaService';
import { VideoFile, VideoFolder } from '@/types';

const albumVideosCache = new Map<string, VideoFile[]>();
const dirtyAlbumCovers = new Set<string>();

export function markAlbumCoverDirty(albumTitle: string | null | undefined) {
    if (!albumTitle) {return;}
    dirtyAlbumCovers.add(albumTitle);
}

export function consumeDirtyAlbumCovers(): string[] {
    const albums = Array.from(dirtyAlbumCovers);
    dirtyAlbumCovers.clear();
    return albums;
}

export function useAlbums() {
    const [albums, setAlbums] = useState<VideoFolder[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const fetchAlbums = useCallback(async (forceRefresh = false) => {
        setLoading(true);
        try {
            const data = await MediaService.getAlbums(forceRefresh);
            setAlbums(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Failed to fetch albums'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAlbums();
    }, [fetchAlbums]);

    return { albums, folders: albums, loading, error, refetch: () => fetchAlbums(true) };
}

export function useFolders() {
    return useAlbums();
}

export function useVideos() {
    const [videos, setVideos] = useState<VideoFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const fetchVideos = useCallback(async (forceRefresh = false) => {
        setLoading(true);
        try {
            const data = await MediaService.getAllVideos(forceRefresh);
            setVideos(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Failed to fetch videos'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchVideos();
    }, [fetchVideos]);

    return { videos, loading, error, refetch: () => fetchVideos(true) };
}

/**
 * Episode 2 before Episode 10, which plain string order gets wrong. MediaStore hands
 * folders back newest first, so without this "next" plays the file downloaded before
 * this one.
 */
const videoNameCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function sortVideosByName(list: VideoFile[]): VideoFile[] {
    return [...list].sort((a, b) => videoNameCollator.compare(a.name, b.name));
}

export function useAlbumVideos(albumTitle: string | null, bucketId?: string) {
    const [videos, setVideos] = useState<VideoFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);

    const cacheKey = bucketId || albumTitle;

    const fetchVideos = useCallback(async (refresh = false) => {
        if (!albumTitle && !bucketId) {return;}
        if (loading) {return;}

        if (refresh) {
            setLoading(true);
        }

        try {
            const result = sortVideosByName(
                await MediaService.getVideosByAlbum(albumTitle || '', refresh, bucketId)
            );
            setVideos(result);
            if (cacheKey) {
                albumVideosCache.set(cacheKey, result);
            }
            setHasMore(false);
        } catch (error) {
            console.error('Failed to fetch album videos:', error);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [albumTitle, bucketId, cacheKey, loading]);

    useEffect(() => {
        if (!albumTitle && !bucketId) {return;}
        if (cacheKey) {
            const cached = albumVideosCache.get(cacheKey);
            if (cached && cached.length > 0) {
                setVideos(cached);
                fetchVideos(true);
                return;
            }
        }

        setVideos([]);
        fetchVideos(true);
    }, [albumTitle, bucketId, cacheKey]);

    return {
        videos,
        loading,
        loadingMore,
        hasMore,
        loadMore: () => {},
        refetch: () => {
            if (cacheKey) {
                albumVideosCache.delete(cacheKey);
                MediaService.invalidateVideosCache(cacheKey);
            }
            return fetchVideos(true);
        },
    };
}

export function useAlbumCover(albumTitle: string, refreshKey: number = 0) {
    const [coverVideo, setCoverVideo] = useState<VideoFile | null>(null);

    useEffect(() => {
        let isMounted = true;

        const fetchCover = async () => {
            try {
                const videos = await MediaService.getVideosByAlbum(albumTitle);
                if (isMounted && videos.length > 0) {
                    setCoverVideo(videos[0]);
                } else if (isMounted) {
                    setCoverVideo(null);
                }
            } catch (error) {
                // ignore
            }
        };

        fetchCover();

        return () => { isMounted = false; };
    }, [albumTitle, refreshKey]);

    return coverVideo;
}
