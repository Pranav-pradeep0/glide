import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { FlashList, FlashListRef } from '@shopify/flash-list';
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
    /** A list given whole (another app's video_list) instead of the folder's. */
    videos?: VideoFile[];
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
    videos: givenVideos,
}) => {
    const album = useAlbumVideos(givenVideos ? null : albumName || null, bucketId, videoSort);
    const videos = givenVideos ?? album.videos;
    const loading = !givenVideos && album.loading;

    const handlePlayAndClose = useCallback((video: VideoFile) => {
        onPlayVideo(video);
        onClose();
    }, [onPlayVideo, onClose]);

    // Landscape keeps the panel mounted while closed, so the list (and every row's thumbnail
    // request) waits for the first open, then stays for the next ones.
    const [opened, setOpened] = useState(visible);
    if (visible && !opened) { setOpened(true); }

    // Open on the current video, on every open. FlashList estimates rows it hasn't measured.
    const listRef = useRef<FlashListRef<VideoFile>>(null);
    const currentIndex = videos.findIndex(v => v.path === currentVideoPath);
    useEffect(() => {
        if (visible && opened && currentIndex > 0) {
            listRef.current?.scrollToIndex({ index: currentIndex, viewPosition: 0.3, animated: false });
        }
    }, [visible, opened, currentIndex]);

    return (
        <SidePanel
            visible={visible}
            title={videos.length > 0 ? `Playlist · ${videos.length}` : 'Playlist'}
            onClose={onClose}
            onBack={onBack}
        >
            {opened && <FlashList
                ref={listRef}
                data={videos}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
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
            />}
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
