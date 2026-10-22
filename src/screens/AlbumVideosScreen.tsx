import React, { useCallback, useState, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList, VideoFile, VideoSort } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useAlbumVideos } from '@/hooks/useMediaService';
import { usePermissionStore } from '@/store/permissionStore';
import { PermissionGate } from '@/components/PermissionGate';
import { formatFileSize } from '@/utils/formatUtils';
import { NavigationService } from '@/services/NavigationService';
import { VideoOptionsBottomSheet } from '@/components/VideoOptionsBottomSheet';
import { Loader } from '@/components/Loader';
import { Button, IconButton, SortButton } from '@/components/ui';
import {
    EmptyState, ListHeader, VideoCard, VideoItemCell, VideoItemComponent, VideoRow,
    deleteVideo, joinMeta, listContentStyle, progressOf, shareVideo, timeLabel,
} from '@/components/VideoRow';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import { metrics, type } from '@/theme/theme';
import { IS_TV } from '@/utils/tv';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type AlbumVideosRouteProp = RouteProp<RootStackParamList, 'AlbumVideos'>;
type ViewMode = 'grid' | 'list';

const SORT_OPTIONS: { key: VideoSort; label: string }[] = [
    { key: 'date', label: 'Newest' },
    { key: 'name', label: 'Name' },
    { key: 'size', label: 'Largest' },
];

export default function AlbumVideosScreen() {
    const theme = useTheme();
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<AlbumVideosRouteProp>();
    const insets = useSafeAreaInsets();
    const clearHistoryForPath = useVideoHistoryStore(state => state.clearVideoHistory);
    const history = useVideoHistoryStore(state => state.history);
    const { albumTitle, bucketId } = route.params;
    // Unpicked: episode order for a series, newest first otherwise (useAlbumVideos).
    const [sort, setSort] = useState<VideoSort>();
    const { videos, order, loading, loadingMore, hasMore, loadMore } = useAlbumVideos(albumTitle, bucketId, sort);
    const videoAccess = usePermissionStore((s) => s.video.access);
    // Cards on a TV: bigger targets, and the D-pad moves across as well as down.
    const [viewMode, setViewMode] = useState<ViewMode>(IS_TV ? 'grid' : 'list');
    const [selectedVideo, setSelectedVideo] = useState<VideoFile | null>(null);
    const [optionsVisible, setOptionsVisible] = useState(false);

    const handleVideoPress = useCallback((video: VideoFile) => {
        NavigationService.handleVideoNavigation(navigation, video.path, {
            videoName: video.name,
            contentUri: video.uri, // Original content:// URI for history storage
            albumName: albumTitle,
            bucketId: video.bucketId || bucketId,
            videoSort: sort,
        });
    }, [navigation, albumTitle, bucketId, sort]);

    // Straight into the player (no detail page) so the whole folder plays through.
    const handlePlayAll = () => {
        const first = videos[0];
        navigation.navigate('VideoPlayer', {
            videoPath: first.path,
            videoName: first.name,
            contentUri: first.uri,
            albumName: albumTitle,
            bucketId: first.bucketId || bucketId,
            playAll: true,
            videoSort: sort,
        });
    };

    const handleOpenOptions = useCallback((video: VideoFile) => {
        setSelectedVideo(video);
        setOptionsVisible(true);
    }, []);

    const handleDelete = () => {
        const video = selectedVideo;
        if (!video) {return;}
        // The folder list and this one reload on MediaService's change signal.
        deleteVideo(video.name, video.uri || video.path).then((deleted) => {
            if (deleted) {clearHistoryForPath(video.path);}
        });
    };

    const getHistoryEntry = useCallback((file: VideoFile) => {
        let entry = history.get(file.path);
        if (!entry && !file.path.startsWith('file://')) {
            entry = history.get(`file://${file.path}`);
        }
        if (!entry && file.path.startsWith('file://')) {
            entry = history.get(file.path.replace('file://', ''));
        }
        return entry ?? null;
    }, [history]);

    const grid = viewMode === 'grid';

    const renderItem = useCallback(({ item, index }: { item: VideoFile; index: number }) => {
        const entry = getHistoryEntry(item);
        const Item: VideoItemComponent = grid ? VideoCard : VideoRow;
        return (
            <VideoItemCell grid={grid}>
                <Item
                    item={item}
                    path={item.path}
                    name={item.name}
                    meta={joinMeta(timeLabel(item.duration, entry?.lastPausedPosition), item.size > 0 && formatFileSize(item.size))}
                    duration={item.duration}
                    progress={progressOf(entry?.duration, entry?.lastPausedPosition)}
                    onPress={handleVideoPress}
                    onMore={handleOpenOptions}
                    preferFocus={index === 0}
                />
            </VideoItemCell>
        );
    }, [grid, handleVideoPress, handleOpenOptions, getHistoryEntry]);

    if (videoAccess === 'unknown' || (loading && videos.length === 0 && videoAccess !== 'denied')) {
        return <Loader fullScreen />;
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
            <ListHeader
                title={albumTitle}
                onBack={() => navigation.goBack()}
            >
                <IconButton
                    icon="search"
                    onPress={() => navigation.navigate('Search')}
                    accessibilityLabel="Search videos"
                />
                <IconButton
                    icon={grid ? 'list' : 'grid'}
                    onPress={() => setViewMode(grid ? 'list' : 'grid')}
                    accessibilityLabel={grid ? 'Switch to list view' : 'Switch to grid view'}
                />
            </ListHeader>

            {videoAccess === 'denied' ? (
                <PermissionGate kind="video" />
            ) : videos.length === 0 ? (
                <EmptyState text="No videos in this folder" />
            ) : (
                <FlashList
                    data={videos}
                    renderItem={renderItem}
                    extraData={history}
                    keyExtractor={(item: VideoFile) => item.path}
                    numColumns={grid ? metrics.grid.columns : 1}
                    key={viewMode}
                    onEndReachedThreshold={0.5}
                    onEndReached={() => {
                        if (hasMore) {loadMore();}
                    }}
                    ListHeaderComponent={(
                        <View style={styles.countRow}>
                            <View style={styles.countText}>
                                <Text style={[type.caption, { color: theme.colors.textSecondary }]}>
                                    {videos.length} video{videos.length !== 1 ? 's' : ''} ·
                                </Text>
                                <SortButton options={SORT_OPTIONS} value={order} onChange={setSort} />
                            </View>
                            <Button label="Play all" icon="play" variant="primary" onPress={handlePlayAll} />
                        </View>
                    )}
                    ListFooterComponent={loadingMore ? <Loader fullScreen={false} size="small" /> : null}
                    contentContainerStyle={listContentStyle(grid, insets.bottom)}
                    showsVerticalScrollIndicator={false}
                />
            )}

            <VideoOptionsBottomSheet
                visible={optionsVisible}
                video={selectedVideo}
                onClose={() => setOptionsVisible(false)}
                onPlay={() => selectedVideo && handleVideoPress(selectedVideo)}
                onShare={() => selectedVideo && shareVideo(selectedVideo.path)}
                onDelete={handleDelete}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    countRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: metrics.space.sm,
        paddingBottom: metrics.space.sm,
    },
    countText: { flexDirection: 'row', alignItems: 'center', gap: metrics.space.xs },
});
