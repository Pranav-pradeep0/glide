import { useState, useEffect, useMemo, useCallback } from 'react';
import { useVideoIndexStore } from '@/store/videoIndexStore';
import { VideoFile } from '@/types';

interface UseVideoSearchResult {
    query: string;
    setQuery: (query: string) => void;
    results: VideoFile[];
    isIndexReady: boolean;
    isIndexing: boolean;
    /** The typed query has not been searched yet (debounce still running). */
    isPending: boolean;
    clearSearch: () => void;
    forceRefresh: () => Promise<void>;
}

/**
 * Hook for searching videos with debouncing.
 * Uses the video index store for instant in-memory search.
 *
 * @param debounceMs - Debounce delay in milliseconds (default: 300)
 */
export function useVideoSearch(debounceMs = 300): UseVideoSearchResult {
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');

    // One field per subscription: the whole store includes the video list, so subscribing
    // to all of it re-ran the search on every index change.
    const searchVideos = useVideoIndexStore(s => s.searchVideos);
    // Only so results follow a re-index; the search itself reads the store.
    const indexedVideos = useVideoIndexStore(s => s.videos);
    const isIndexReady = useVideoIndexStore(s => s.isIndexReady);
    const isIndexing = useVideoIndexStore(s => s.isIndexing);
    const forceFullSync = useVideoIndexStore(s => s.forceFullSync);

    // Debounce the query
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(query);
        }, debounceMs);

        return () => clearTimeout(timer);
    }, [query, debounceMs]);

    // Search results (instant once index is ready)
    const results = useMemo(() => {
        if (!isIndexReady || !debouncedQuery.trim()) {
            return [];
        }
        return searchVideos(debouncedQuery);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- indexedVideos is what searchVideos reads
    }, [debouncedQuery, isIndexReady, searchVideos, indexedVideos]);

    const clearSearch = useCallback(() => {
        setQuery('');
        setDebouncedQuery('');
    }, []);

    const forceRefresh = useCallback(async () => {
        await forceFullSync();
    }, [forceFullSync]);

    return {
        query,
        setQuery,
        results,
        isIndexReady,
        isIndexing,
        isPending: query.trim() !== debouncedQuery.trim(),
        clearSearch,
        forceRefresh,
    };
}
