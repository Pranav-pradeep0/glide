import { useState, useEffect } from 'react';
import { ThumbnailService } from '@/services/ThumbnailService';

/** `timeMs` picks the frame; 0 is the service's smart scan. */
export function useThumbnail(videoPath: string | undefined, timeMs = 0) {
    const [thumbnail, setThumbnail] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let isMounted = true;
        // Identifies this row's request, so unmounting cancels its own wait and leaves any
        // other row showing the same video still waiting.
        const token = {};

        if (!videoPath) {
            setThumbnail(null);
            return;
        }

        setThumbnail(null);

        const fetchThumbnail = async () => {
            setLoading(true);
            try {
                const thumb = await ThumbnailService.getThumbnail(videoPath, timeMs, token);
                if (isMounted) {
                    setThumbnail(thumb);
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
            if (videoPath) {
                ThumbnailService.cancelRequest(videoPath, timeMs, token);
            }
        };
    }, [videoPath, timeMs]);

    return { thumbnail, loading };
}
