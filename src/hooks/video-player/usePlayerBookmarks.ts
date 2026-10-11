/**
 * usePlayerBookmarks Hook
 *
 * Manages video bookmarks using the videoHistoryStore.
 * Handles adding, deleting, and jumping to bookmarks; feedback goes through the snackbar.
 */

import { useCallback, useMemo } from 'react';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import { useShallow } from 'zustand/shallow';
import { showSnackbar } from '@/components/ui';
import { UsePlayerBookmarksReturn, formatTime } from './types';

interface UsePlayerBookmarksOptions {
    videoPath: string;
    videoName: string;
    duration: number;
    currentTimeRef: React.MutableRefObject<number>;
    onSeekToBookmark: (timestamp: number) => void;
}

const showToastWithMessage = (text: string) => showSnackbar({ text });

export function usePlayerBookmarks(options: UsePlayerBookmarksOptions): UsePlayerBookmarksReturn {
    const {
        videoPath,
        videoName,
        duration,
        currentTimeRef,
        onSeekToBookmark,
    } = options;

    const bookmarks = useVideoHistoryStore(
        useShallow((state) => state.getVideoHistory(videoPath)?.bookmarks || [])
    );

    const storeAddBookmark = useVideoHistoryStore(state => state.addBookmark);
    const storeRemoveBookmark = useVideoHistoryStore(state => state.removeBookmark);

    const addBookmark = useCallback(() => {
        if (!videoPath || !videoName || duration === 0) {
            if (__DEV__) {console.log('[usePlayerBookmarks] Cannot add bookmark - missing data');}
            return;
        }

        const bookmarkTime = currentTimeRef.current;
        storeAddBookmark(videoPath, videoName, bookmarkTime);

        const added = useVideoHistoryStore.getState().getVideoHistory(videoPath)?.bookmarks
            .find(b => b.timestamp === bookmarkTime);
        showSnackbar({
            text: `Bookmark added at ${formatTime(bookmarkTime)}`,
            tone: 'confirm',
            ...(added && {
                action: 'Undo',
                onAction: () => storeRemoveBookmark(videoPath, added.id),
            }),
        });
    }, [videoPath, videoName, duration, currentTimeRef, storeAddBookmark, storeRemoveBookmark]);

    const deleteBookmark = useCallback((bookmarkId: string) => {
        const removed = bookmarks.find(b => b.id === bookmarkId);
        storeRemoveBookmark(videoPath, bookmarkId);
        showSnackbar({
            text: 'Bookmark deleted',
            action: removed ? 'Undo' : undefined,
            onAction: removed ? () => storeAddBookmark(videoPath, videoName, removed.timestamp, removed.label) : undefined,
        });
    }, [videoPath, videoName, bookmarks, storeRemoveBookmark, storeAddBookmark]);

    const jumpToBookmark = useCallback((timestamp: number) => {
        onSeekToBookmark(timestamp);
    }, [onSeekToBookmark]);

    return useMemo(() => ({
        bookmarks,
        addBookmark,
        deleteBookmark,
        jumpToBookmark,
        showToastWithMessage,
    }), [bookmarks, addBookmark, deleteBookmark, jumpToBookmark]);
}

export default usePlayerBookmarks;
