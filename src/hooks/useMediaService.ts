import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MediaService } from '@/services/MediaService';
import { VideoFile, VideoFolder, VideoSort } from '@/types';
import { FilenameParser } from '@/utils/FilenameParser';

const albumVideosCache = new Map<string, VideoFile[]>();

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
        // New files, deletions elsewhere, or access just granted: the cache is already
        // dropped, so a plain fetch scans again (and shares that scan with other screens).
        return MediaService.onChange(() => fetchAlbums());
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

/** A series (every file has an episode number) plays in episode order; anything else newest first. */
export function defaultVideoSort(list: VideoFile[]): VideoSort {
    return list.length > 1 && list.every(v => FilenameParser.parse(v.name).episode !== undefined) ? 'name' : 'date';
}

export function sortVideos(list: VideoFile[], sort: VideoSort): VideoFile[] {
    if (sort === 'name') { return sortVideosByName(list); }
    const key = sort === 'date' ? (v: VideoFile) => v.modifiedDate : (v: VideoFile) => v.size;
    return [...list].sort((a, b) => key(b) - key(a));
}

export function sortVideosByName(list: VideoFile[]): VideoFile[] {
    const byName = (a: VideoFile, b: VideoFile) => videoNameCollator.compare(a.name, b.name);
    // Names alone put "Show.2019.S01E02" before "Show.S01E01". When every file carries an
    // episode number, season and episode decide; all-or-nothing, because mixing the two
    // orders in one comparator is not transitive and sort() would scramble the list.
    const parsed = list.map(v => ({ v, p: FilenameParser.parse(v.name) }));
    if (list.length < 2 || parsed.some(x => x.p.episode === undefined)) {
        return [...list].sort(byName);
    }
    return parsed
        .sort((a, b) => (a.p.season ?? 0) - (b.p.season ?? 0)
            || a.p.episode! - b.p.episode!
            || byName(a.v, b.v))
        .map(x => x.v);
}

/**
 * A folder's videos in `sort` order, or the folder's default order when none was picked.
 * The folder screen and the player both read it, so Next follows what the list showed.
 */
export function useAlbumVideos(albumTitle: string | null, bucketId?: string, sort?: VideoSort) {
    const [unsorted, setVideos] = useState<VideoFile[]>([]);
    const order = useMemo(() => sort ?? defaultVideoSort(unsorted), [sort, unsorted]);
    const videos = useMemo(() => sortVideos(unsorted, order), [unsorted, order]);
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
            const result = await MediaService.getVideosByAlbum(albumTitle || '', refresh, bucketId);
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

    // The library changed (files added or removed, access granted): load this folder again.
    const fetchRef = useRef(fetchVideos);
    fetchRef.current = fetchVideos;
    useEffect(() => MediaService.onChange(() => {
        if (cacheKey) {albumVideosCache.delete(cacheKey);}
        fetchRef.current(true);
    }), [cacheKey]);

    return {
        videos,
        order,
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
