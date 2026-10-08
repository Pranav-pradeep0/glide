import React, { useCallback, useState, useMemo } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList, VideoFile, VideoHistoryEntry } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { markAlbumCoverDirty, useAlbumVideos } from '@/hooks/useMediaService';
import { MediaService } from '@/services/MediaService';
import { formatFileSize } from '@/utils/formatUtils';
import { NavigationService } from '@/services/NavigationService';
import { VideoOptionsBottomSheet } from '@/components/VideoOptionsBottomSheet';
import { Loader } from '@/components/Loader';
import { Button, IconButton } from '@/components/ui';
import {
    EmptyState, ListHeader, VideoCard, VideoItemCell, VideoRow,
    confirmDelete, joinMeta, listContentStyle, progressOf, shareVideo, timeLabel,
} from '@/components/VideoRow';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import { metrics } from '@/theme/theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type AlbumVideosRouteProp = RouteProp<RootStackParamList, 'AlbumVideos'>;
type ViewMode = 'grid' | 'list';

export default function AlbumVideosScreen() {
    const theme = useTheme();
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<AlbumVideosRouteProp>();
    const insets = useSafeAreaInsets();
    const clearHistoryForPath = useVideoHistoryStore(state => state.clearVideoHistory);
    const history = useVideoHistoryStore(state => state.history);
    const { albumTitle, bucketId } = route.params;
    const { videos, loading, loadingMore, hasMore, loadMore, refetch } = useAlbumVideos(albumTitle, bucketId);
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [selectedVideo, setSelectedVideo] = useState<VideoFile | null>(null);
    const [optionsVisible, setOptionsVisible] = useState(false);

    const handleVideoPress = useCallback((video: VideoFile) => {
        NavigationService.handleVideoNavigation(navigation, video.path, {
            videoName: video.name,
            contentUri: video.uri, // Original content:// URI for history storage
            albumName: albumTitle,
            bucketId: video.bucketId || bucketId,
        });
    }, [navigation, albumTitle, bucketId]);

    const handleOpenOptions = useCallback((video: VideoFile) => {
        setSelectedVideo(video);
        setOptionsVisible(true);
    }, []);

    const handleDelete = () => {
        const video = selectedVideo;
        if (!video) {return;}
        const videoUri = video.uri;
        if (!videoUri) {
            Alert.alert('Delete failed', 'Cannot delete: missing media URI.');
            return;
        }
        confirmDelete(video.name, async () => {
            try {
                await MediaService.deleteVideos([videoUri]);
                clearHistoryForPath(video.path);
                markAlbumCoverDirty(albumTitle);
                refetch();
            } catch (error) {
                console.error('[AlbumVideosScreen] Delete failed:', error);
                Alert.alert('Delete failed', 'Could not delete the file. Please check permissions.');
            }
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

    const renderItem = useCallback(({ item }: { item: VideoFile }) => {
        const entry = getHistoryEntry(item);
        const Item = grid ? VideoCard : VideoRow;
        return (
            <VideoItemCell grid={grid}>
                <Item
                    path={item.path}
                    name={item.name}
                    meta={joinMeta(timeLabel(item.duration, entry?.lastPausedPosition), item.size > 0 && formatFileSize(item.size))}
                    duration={item.duration}
                    progress={progressOf(entry?.duration, entry?.lastPausedPosition)}
                    onPress={() => handleVideoPress(item)}
                    onMore={() => handleOpenOptions(item)}
                />
            </VideoItemCell>
        );
    }, [grid, handleVideoPress, handleOpenOptions, getHistoryEntry]);

    if (loading && videos.length === 0) {
        return <Loader fullScreen />;
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
            <ListHeader
                title={albumTitle}
                subtitle={`${videos.length} video${videos.length !== 1 ? 's' : ''}`}
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

            {videos.length === 0 ? (
                <EmptyState text="No videos in this folder" />
            ) : (
                <FlashList
                    data={videos}
                    renderItem={renderItem}
                    extraData={history}
                    keyExtractor={(item: VideoFile) => item.path}
                    numColumns={grid ? 2 : 1}
                    key={viewMode}
                    onEndReachedThreshold={0.5}
                    onEndReached={() => {
                        if (hasMore) {loadMore();}
                    }}
                    ListHeaderComponent={(
                        <View style={styles.playAll}>
                            <Button
                                label="Play all"
                                icon="play"
                                variant="primary"
                                onPress={() => handleVideoPress(videos[0])}
                            />
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
    playAll: { alignItems: 'flex-start', paddingHorizontal: metrics.space.sm, paddingVertical: metrics.space.sm },
});
