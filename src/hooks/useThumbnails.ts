import { useState, useEffect } from 'react';
import { ThumbnailService } from '@/services/ThumbnailService';

/** `timeMs` picks the frame; 0 is the service's smart scan. */
export function useThumbnail(videoPath: string | undefined, timeMs = 0) {
    // Tagged with the request it answers: a recycled list row renders with its new path
    // before the effect runs, and must not paint the previous video's frame meanwhile.
    const [result, setResult] = useState<{ key: string; uri: string | null } | null>(null);
    const [loading, setLoading] = useState(false);
    const key = `${videoPath}|${timeMs}`;

    useEffect(() => {
        let isMounted = true;
        // Identifies this row's request, so unmounting cancels its own wait and leaves any
        // other row showing the same video still waiting.
        const token = {};

        if (!videoPath) {
            return;
        }

        const fetchThumbnail = async () => {
            setLoading(true);
            try {
                const thumb = await ThumbnailService.getThumbnail(videoPath, timeMs, token);
                if (isMounted) {
                    setResult({ key: `${videoPath}|${timeMs}`, uri: thumb });
                }
            } catch (error) {
                console.error('Failed to load thumbnail:', error);
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        fetchThumbnail();

        return () => {
            isMounted = false;
            ThumbnailService.cancelRequest(videoPath, timeMs, token);
        };
    }, [videoPath, timeMs]);

    const thumbnail = videoPath && result?.key === key ? result.uri : null;
    return { thumbnail, loading };
}
