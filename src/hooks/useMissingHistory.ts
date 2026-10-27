import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { findMissingHistory, useVideoHistoryStore } from '@/store/videoHistoryStore';
import { MediaService } from '@/services/MediaService';
import { FileService } from '@/services/FileService';

/**
 * Watched files that are gone, checked each time the screen gains focus. Files moved since
 * they were watched are relinked; ones gone everywhere are reported to hide, not deleted.
 */
export function useMissingHistory(enabled = true) {
    const getAllHistory = useVideoHistoryStore(s => s.getAllHistory);
    const relinkMoved = useVideoHistoryStore(s => s.relinkMoved);
    const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());

    const check = useCallback(async (forceRefresh = false) => {
        const { videos } = await MediaService.getLibrary(forceRefresh);
        const found = await findMissingHistory(getAllHistory(), videos, p => FileService.exists(p));
        relinkMoved(found.moves);
        setMissing(found.missing);
    }, [getAllHistory, relinkMoved]);

    useFocusEffect(useCallback(() => {
        if (!enabled) {return;}
        check().catch(error => console.error('[useMissingHistory] Missing check error:', error));
    }, [check, enabled]));

    return { missing, check };
}
