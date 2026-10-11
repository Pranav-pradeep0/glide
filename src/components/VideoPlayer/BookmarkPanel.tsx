// components/VideoPlayer/BookmarkPanel.tsx
import React, { useMemo, memo, useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { VideoBookmark } from '@/types';
import { findActiveBookmarkId } from '@/hooks/video-player/types';
import { Button, IconButton, Touchable } from '@/components/ui';
import { metrics, playerTheme, type } from '@/theme/theme';
import { SidePanel } from './SidePanel';

const { colors } = playerTheme;

interface BookmarkPanelProps {
    visible: boolean;
    bookmarks: VideoBookmark[];
    /** Highlighting reads this on the UI thread, so progress never renders the screen. */
    currentTime: SharedValue<number>;
    onClose: () => void;
    onBack?: () => void;
    onSelectBookmark: (timestamp: number) => void;
    onDeleteBookmark: (bookmarkId: string) => void;
    /** Saves the current moment; the panel stays open so the new bookmark shows up. */
    onAddBookmark: () => void;
    formatTime: (seconds: number) => string;
}

const BookmarkItem = memo<{
    bookmark: VideoBookmark;
    isActive: boolean;
    onSelect: (timestamp: number) => void;
    onDelete: (bookmarkId: string) => void;
    formatTime: (seconds: number) => string;
}>(({ bookmark, isActive, onSelect, onDelete, formatTime }) => {
    const handleSelect = useCallback(() => {
        onSelect(bookmark.timestamp);
    }, [bookmark.timestamp, onSelect]);

    const handleDelete = useCallback(() => {
        onDelete(bookmark.id);
    }, [bookmark.id, onDelete]);

    const time = formatTime(bookmark.timestamp);

    return (
        <View style={styles.row}>
            <Touchable
                onPress={handleSelect}
                scaleTo={1}
                stateLayer
                onPlayer
                style={styles.rowMain}
                accessibilityRole="button"
                accessibilityLabel={bookmark.label ? `Jump to ${time}, ${bookmark.label}` : `Jump to ${time}`}
                accessibilityState={{ selected: isActive }}
            >
                <Text style={[styles.time, isActive && styles.timeActive]}>{time}</Text>
                {!!bookmark.label && (
                    <Text style={styles.label} numberOfLines={2} ellipsizeMode="tail">
                        {bookmark.label}
                    </Text>
                )}
            </Touchable>
            <IconButton
                icon="trash-2"
                iconSize={16}
                color={colors.textSecondary}
                onPress={handleDelete}
                accessibilityLabel={`Delete bookmark at ${time}`}
                onPlayer
                style={styles.delete}
            />
        </View>
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.bookmark.id === nextProps.bookmark.id &&
        prevProps.bookmark.timestamp === nextProps.bookmark.timestamp &&
        prevProps.bookmark.label === nextProps.bookmark.label &&
        prevProps.isActive === nextProps.isActive &&
        prevProps.onSelect === nextProps.onSelect &&
        prevProps.onDelete === nextProps.onDelete
    );
});

BookmarkItem.displayName = 'BookmarkItem';

export const BookmarkPanel: React.FC<BookmarkPanelProps> = memo(({
    visible,
    bookmarks,
    currentTime,
    onClose,
    onBack,
    onSelectBookmark,
    onDeleteBookmark,
    onAddBookmark,
    formatTime,
}) => {
    const sortedBookmarks = useMemo(() => {
        return [...bookmarks].sort((a, b) => a.timestamp - b.timestamp);
    }, [bookmarks]);

    // Highlight the bookmark the playhead is sitting on. The comparison runs on the UI
    // thread against every frame's position, but only crossing into or out of a
    // bookmark's window renders anything, and only while the panel is open.
    const [activeBookmarkId, setActiveBookmarkId] = useState<string | null>(null);
    const timeline = useMemo(
        () => sortedBookmarks.map((bookmark) => ({ id: bookmark.id, timestamp: bookmark.timestamp })),
        [sortedBookmarks]
    );

    useAnimatedReaction(
        () => (visible ? findActiveBookmarkId(timeline, currentTime.value) : null),
        (id, previous) => {
            if (id !== previous) {
                runOnJS(setActiveBookmarkId)(id);
            }
        });

    const handleSelectAndClose = useCallback((timestamp: number) => {
        onSelectBookmark(timestamp);
        onClose();
    }, [onSelectBookmark, onClose]);

    const count = sortedBookmarks.length;

    return (
        <SidePanel visible={visible} title={count > 0 ? `Bookmarks · ${count}` : 'Bookmarks'} onClose={onClose} onBack={onBack}>
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                removeClippedSubviews={true}
            >
                {count === 0 ? (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyText}>No bookmarks yet</Text>
                        <Text style={styles.emptySubtext}>Save moments to jump back to them later.</Text>
                        <Button label="Add bookmark here" icon="bookmark" variant="primary" onPress={onAddBookmark} onPlayer style={styles.emptyButton} />
                    </View>
                ) : (
                    sortedBookmarks.map((bookmark) => (
                        <BookmarkItem
                            key={bookmark.id}
                            bookmark={bookmark}
                            isActive={bookmark.id === activeBookmarkId}
                            onSelect={handleSelectAndClose}
                            onDelete={onDeleteBookmark}
                            formatTime={formatTime}
                        />
                    ))
                )}
            </ScrollView>
        </SidePanel>
    );
}, (prevProps, nextProps) => {
    // Optimize re-renders - only update when necessary
    if (prevProps.visible !== nextProps.visible) {return false;}
    // Reference, not length: editing a bookmark's timestamp must re-render too.
    if (prevProps.bookmarks !== nextProps.bookmarks) {return false;}
    if (prevProps.onSelectBookmark !== nextProps.onSelectBookmark) {return false;}
    if (prevProps.onDeleteBookmark !== nextProps.onDeleteBookmark) {return false;}
    if (prevProps.onBack !== nextProps.onBack) {return false;}
    // currentTime is a SharedValue with a stable identity; highlighting is handled inside.
    return true;
});

BookmarkPanel.displayName = 'BookmarkPanel';

const styles = StyleSheet.create({
    scrollView: { flex: 1 },
    scrollContent: { paddingBottom: metrics.space.xl },
    emptyState: { alignItems: 'center', paddingVertical: 64, paddingHorizontal: metrics.space.xl, gap: 6 },
    emptyText: { ...type.heading, color: colors.text },
    emptyButton: { marginTop: metrics.space.lg },
    emptySubtext: { ...type.body, color: colors.textSecondary, textAlign: 'center' },
    row: { flexDirection: 'row', alignItems: 'center' },
    rowMain: {
        flex: 1,
        minHeight: 56,
        justifyContent: 'center',
        paddingVertical: metrics.space.md,
        paddingHorizontal: metrics.space.xs,
        borderRadius: metrics.radius.md,
        gap: 2,
    },
    time: { ...type.row, color: colors.text, fontVariant: ['tabular-nums'] },
    timeActive: { color: colors.primary },
    label: { ...type.caption, color: colors.textSecondary },
    delete: { marginLeft: metrics.space.xs },
});
