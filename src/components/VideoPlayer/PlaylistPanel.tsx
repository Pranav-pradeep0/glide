import React, { memo, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Image, FlatList } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import { VideoFile, VideoSort } from '@/types';
import { useAlbumVideos } from '@/hooks/useMediaService';
import { useThumbnail } from '@/hooks/useThumbnails';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import { ProgressLine, progressOf } from '@/components/VideoRow';
import { formatDuration } from '@/utils/formatUtils';
import { Touchable } from '@/components/ui';
import { metrics, playerTheme, type } from '@/theme/theme';
import { SidePanel } from './SidePanel';

const { colors } = playerTheme;

interface PlaylistPanelProps {
    visible: boolean;
    onClose: () => void;
    currentVideoPath: string;
    onPlayVideo: (video: VideoFile) => void;
    isLandscape: boolean;
    albumName?: string;
    bucketId?: string;
    videoSort?: VideoSort;
    onBack?: () => void;
}

const PlaylistItem = memo<{
    item: VideoFile;
    isCurrent: boolean;
    onPlay: (video: VideoFile) => void;
}>(({ item, isCurrent, onPlay }) => {
    const { thumbnail } = useThumbnail(item.path);
    // A number, so a position save elsewhere re-renders only the row whose bar moved.
    const progress = useVideoHistoryStore((s) => {
        const entry = s.getVideoHistory(item.path);
        return progressOf(entry?.duration, entry?.lastPausedPosition);
    });

    const handlePlay = useCallback(() => {
        onPlay(item);
    }, [item, onPlay]);

    const duration = item.duration > 0 ? formatDuration(item.duration) : '';

    return (
        <Touchable
            onPress={handlePlay}
            scaleTo={1}
            stateLayer
            onPlayer
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel={isCurrent ? `${item.name}, now playing` : `Play ${item.name}`}
            accessibilityState={{ selected: isCurrent }}
        >
            <View style={styles.thumbnail}>
                {thumbnail ? (
                    <Image source={{ uri: thumbnail }} style={styles.thumbnailImage} resizeMode="cover" />
                ) : (
                    <Feather name="video" size={20} color={colors.textTertiary} />
                )}
                {progress > 0 && <ProgressLine progress={progress} style={styles.progress} />}
            </View>

            <View style={styles.info}>
                <Text
                    style={styles.title}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                >
                    {item.name}
                </Text>
                {!!duration && <Text style={styles.duration}>{duration}</Text>}
            </View>
        {isCurrent && <Feather name="check" size={20} color={colors.primary} />}
        </Touchable>
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.item.path === nextProps.item.path &&
        prevProps.isCurrent === nextProps.isCurrent &&
        prevProps.onPlay === nextProps.onPlay
    );
});

PlaylistItem.displayName = 'PlaylistItem';

export const PlaylistPanel: React.FC<PlaylistPanelProps> = memo(({
    visible,
    onClose,
    currentVideoPath,
    onPlayVideo,
    albumName,
    bucketId,
    videoSort,
    onBack,
}) => {
    const { videos, loading } = useAlbumVideos(albumName || null, bucketId, videoSort);

    const handlePlayAndClose = useCallback((video: VideoFile) => {
        onPlayVideo(video);
        onClose();
    }, [onPlayVideo, onClose]);

    // Open on the current video. Landscape keeps the list mounted while closed, so this runs
    // on every open, not just the first. Rows vary in height (one- or two-line titles), so a
    // row not yet measured fails the first try: jump near it, then try again.
    const listRef = useRef<FlatList<VideoFile>>(null);
    const currentIndex = videos.findIndex(v => v.path === currentVideoPath);
    const scrollRetries = useRef(0);
    useEffect(() => {
        scrollRetries.current = 0;
        if (visible && currentIndex > 0) {
            listRef.current?.scrollToIndex({ index: currentIndex, viewPosition: 0.3, animated: false });
        }
    }, [visible, currentIndex]);
    const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
        listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        if (scrollRetries.current >= 3) { return; }
        scrollRetries.current += 1;
        setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.3, animated: false }), 50);
    }, []);

    return (
        <SidePanel
            visible={visible}
            title={videos.length > 0 ? `Playlist · ${videos.length}` : 'Playlist'}
            onClose={onClose}
            onBack={onBack}
        >
            <FlatList
                ref={listRef}
                data={videos}
                onScrollToIndexFailed={onScrollToIndexFailed}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                removeClippedSubviews={true}
                initialNumToRender={10}
                maxToRenderPerBatch={5}
                windowSize={5}
                keyExtractor={(item) => item.path}
                renderItem={({ item }) => (
                    <PlaylistItem
                        item={item}
                        isCurrent={item.path === currentVideoPath}
                        onPlay={handlePlayAndClose}
                    />
                )}
                ListEmptyComponent={
                    <Text style={styles.emptyText}>{loading ? 'Loading…' : 'This playlist is empty'}</Text>
                }
            />
        </SidePanel>
    );
}, (prevProps, nextProps) => {
    if (prevProps.visible !== nextProps.visible) {return false;}
    if (prevProps.currentVideoPath !== nextProps.currentVideoPath) {return false;}
    if (prevProps.onPlayVideo !== nextProps.onPlayVideo) {return false;}
    if (prevProps.albumName !== nextProps.albumName) {return false;}
    if (prevProps.bucketId !== nextProps.bucketId) {return false;}
    if (prevProps.onBack !== nextProps.onBack) {return false;}
    return true;
});

PlaylistPanel.displayName = 'PlaylistPanel';

const styles = StyleSheet.create({
    list: { flex: 1 },
    listContent: { paddingBottom: metrics.space.xl },
    emptyText: {
        ...type.body,
        color: colors.textSecondary,
        textAlign: 'center',
        paddingVertical: 64,
        paddingHorizontal: metrics.space.xl,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.md,
        paddingVertical: metrics.space.sm,
        paddingHorizontal: metrics.space.xs,
        borderRadius: metrics.radius.md,
    },
    thumbnail: {
        width: 96,
        height: 54,
        borderRadius: metrics.radius.sm,
        overflow: 'hidden',
        backgroundColor: colors.surfaceVariant,
        alignItems: 'center',
        justifyContent: 'center',
    },
    thumbnailImage: { width: '100%', height: '100%' },
    progress: { position: 'absolute', left: 0, right: 0, bottom: 0 },
    info: { flex: 1, gap: 2 },
    title: { ...type.row, color: colors.text },
    duration: { ...type.caption, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
});
