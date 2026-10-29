import { useState, useEffect } from 'react';
import { AudioMediaService } from '@/services/AudioMediaService';

const artCache = new Map<string, string | null>();
const pendingRequests = new Map<string, Promise<string | null>>();

/**
 * Hook to lazily fetch and cache album artwork for a given albumId and optional songUri.
 * Deduplicates in-flight requests and caches results in memory across the app.
 */
export function useAlbumArt(albumId?: string | null, songUri?: string | null): string | null {
    const cached = albumId ? (artCache.get(albumId) ?? null) : null;
    const [artworkUri, setArtworkUri] = useState<string | null>(cached);
    const [prevAlbumId, setPrevAlbumId] = useState(albumId);

    // When a list row is recycled with a new albumId, update artworkUri immediately to avoid flashing previous art
    if (albumId !== prevAlbumId) {
        setPrevAlbumId(albumId);
        setArtworkUri(cached);
    }

    useEffect(() => {
        if (!albumId) {
            setArtworkUri(null);
            return;
        }

        if (artCache.has(albumId)) {
            setArtworkUri(artCache.get(albumId) ?? null);
            return;
        }

        // Clear previous art before starting request to avoid displaying stale recycled artwork
        setArtworkUri(null);

        let isMounted = true;
        let request = pendingRequests.get(albumId);
        if (!request) {
            request = AudioMediaService.getAlbumArt(albumId, songUri ?? undefined);
            pendingRequests.set(albumId, request);
        }

        request.then((uri) => {
            artCache.set(albumId, uri);
            pendingRequests.delete(albumId);
            if (isMounted) {
                setArtworkUri(uri);
            }
        });

        return () => {
            isMounted = false;
        };
    }, [albumId, songUri]);

    return artworkUri;
}

interface AlbumPaletteResult {
    artworkUri: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
    onPrimaryColor: string | null;
}

const paletteCache = new Map<string, AlbumPaletteResult>();
const pendingPaletteRequests = new Map<string, Promise<AlbumPaletteResult>>();

export function useAlbumPalette(albumId?: string | null, songUri?: string | null): AlbumPaletteResult {
    const cached = albumId ? (paletteCache.get(albumId) ?? null) : null;
    const [result, setResult] = useState<AlbumPaletteResult>(
        cached ?? { artworkUri: null, primaryColor: null, secondaryColor: null, onPrimaryColor: null }
    );
    const [prevAlbumId, setPrevAlbumId] = useState(albumId);

    if (albumId !== prevAlbumId) {
        setPrevAlbumId(albumId);
        setResult(cached ?? { artworkUri: null, primaryColor: null, secondaryColor: null, onPrimaryColor: null });
    }

    useEffect(() => {
        if (!albumId) {
            setResult({ artworkUri: null, primaryColor: null, secondaryColor: null, onPrimaryColor: null });
            return;
        }

        if (paletteCache.has(albumId)) {
            setResult(paletteCache.get(albumId)!);
            return;
        }

        let isMounted = true;
        let request = pendingPaletteRequests.get(albumId);
        if (!request) {
            request = AudioMediaService.getAlbumArtDetails(albumId, songUri ?? undefined);
            pendingPaletteRequests.set(albumId, request);
        }

        request.then((res) => {
            paletteCache.set(albumId, res);
            if (res.artworkUri) {
                artCache.set(albumId, res.artworkUri);
            }
            pendingPaletteRequests.delete(albumId);
            if (isMounted) {
                setResult(res);
            }
        });

        return () => {
            isMounted = false;
        };
    }, [albumId, songUri]);

    return result;
}
