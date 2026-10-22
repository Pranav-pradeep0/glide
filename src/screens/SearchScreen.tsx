// src/screens/SearchScreen.tsx
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
    View,
    TextInput,
    type TextInputInstance,
    StyleSheet,
    RefreshControl,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import Feather from '@react-native-vector-icons/feather';

import { useTheme } from '@/hooks/useTheme';
import { useVideoSearch } from '@/hooks/useVideoSearch';
import { usePermissionStore } from '@/store/permissionStore';
import { useVideoIndexStore } from '@/store/videoIndexStore';
import { PartialAccessBanner, PermissionGate } from '@/components/PermissionGate';
import { NavigationService } from '@/services/NavigationService';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import { VideoFile, RootStackParamList } from '@/types';
import { formatFileSize } from '@/utils/formatUtils';
import { Loader } from '@/components/Loader';
import { metrics, type } from '@/theme/theme';
import { VideoOptionsBottomSheet } from '@/components/VideoOptionsBottomSheet';
import { IconButton } from '@/components/ui';
import { IS_TV } from '@/utils/tv';
import {
    EmptyState, VideoCard, VideoItemCell, VideoItemComponent, VideoRow,
    deleteVideo, joinMeta, listContentStyle, shareVideo,
} from '@/components/VideoRow';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type ViewMode = 'grid' | 'list';

export default function SearchScreen() {
    const theme = useTheme();
    const navigation = useNavigation<NavigationProp>();
    const insets = useSafeAreaInsets();
    const inputRef = useRef<TextInputInstance>(null);
    const clearHistoryForPath = useVideoHistoryStore(state => state.clearVideoHistory);

    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [refreshing, setRefreshing] = useState(false);
    const [selectedVideo, setSelectedVideo] = useState<VideoFile | null>(null);
    const [optionsVisible, setOptionsVisible] = useState(false);

    const {
        query,
        setQuery,
        results,
        isIndexReady,
        isPending,
        clearSearch,
        forceRefresh,
    } = useVideoSearch();
    const videoAccess = usePermissionStore((s) => s.video.access);
    const initializeIndex = useVideoIndexStore((s) => s.initialize);

    // The index is normally built at launch; opened before that (or with access granted
    // since), build it here rather than wait on "Preparing search" for ever.
    useEffect(() => {
        if (!isIndexReady && videoAccess !== 'denied' && videoAccess !== 'unknown') {
            initializeIndex();
        }
    }, [isIndexReady, videoAccess, initializeIndex]);

    // Focus the field once the index is ready, after the screen transition.
    useEffect(() => {
        if (isIndexReady && inputRef.current) {
            const timer = setTimeout(() => inputRef.current?.focus(), 300);
            return () => clearTimeout(timer);
        }
    }, [isIndexReady]);

    const handleVideoPress = useCallback((video: VideoFile) => {
        NavigationService.handleVideoNavigation(navigation, video.path, {
            videoName: video.name,
            contentUri: video.uri,
            albumName: video.album,
            bucketId: video.bucketId,
        });
    }, [navigation]);

    const handleOpenOptions = useCallback((video: VideoFile) => {
        setSelectedVideo(video);
        setOptionsVisible(true);
    }, []);

    const handleDelete = () => {
        const video = selectedVideo;
        if (!video) {return;}
        // The index reloads on MediaService's change signal, so the row goes by itself.
        deleteVideo(video.name, video.uri || video.path).then((deleted) => {
            if (deleted) {clearHistoryForPath(video.path);}
        });
    };

    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        await forceRefresh();
        setRefreshing(false);
    }, [forceRefresh]);

    const grid = viewMode === 'grid';

    const renderItem = useCallback(({ item }: { item: VideoFile }) => {
        const Item: VideoItemComponent = grid ? VideoCard : VideoRow;
        return (
            <VideoItemCell grid={grid}>
                <Item
                    item={item}
                    path={item.path}
                    name={item.name}
                    meta={joinMeta(item.album, item.size > 0 && formatFileSize(item.size))}
                    duration={item.duration}
                    highlight={query}
                    onPress={handleVideoPress}
                    onMore={handleOpenOptions}
                />
            </VideoItemCell>
        );
    }, [grid, query, handleVideoPress, handleOpenOptions]);

    if (videoAccess === 'denied') {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
                <View style={[styles.bar, IS_TV && styles.barTv]}>
                    <IconButton icon="arrow-left" onPress={() => navigation.goBack()} accessibilityLabel="Back" />
                </View>
                <PermissionGate kind="video" />
            </View>
        );
    }

    if (!isIndexReady) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
                <Loader text="Preparing search" />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
            <View style={[styles.bar, IS_TV && styles.barTv]}>
                <IconButton icon="arrow-left" onPress={() => navigation.goBack()} accessibilityLabel="Back" />
                <View style={[styles.searchField, { backgroundColor: theme.colors.cardElevated }]}>
                    <Feather name="search" size={18} color={theme.colors.textSecondary} />
                    <TextInput
                        ref={inputRef}
                        autoFocus
                        style={[type.body, styles.searchInput, { color: theme.colors.text }]}
                        placeholder="Search all videos"
                        placeholderTextColor={theme.colors.textTertiary}
                        selectionColor={theme.colors.primary}
                        value={query}
                        onChangeText={setQuery}
                        autoCorrect={false}
                        autoCapitalize="none"
                        returnKeyType="search"
                        accessibilityLabel="Search all videos"
                    />
                    {query.length > 0 && (
                        <IconButton
                            icon="x"
                            iconSize={18}
                            color={theme.colors.textSecondary}
                            onPress={clearSearch}
                            accessibilityLabel="Clear search"
                        />
                    )}
                </View>
                <IconButton
                    icon={grid ? 'list' : 'grid'}
                    onPress={() => setViewMode(grid ? 'list' : 'grid')}
                    accessibilityLabel={grid ? 'Switch to list view' : 'Switch to grid view'}
                />
            </View>

            <PartialAccessBanner />
            {results.length === 0 ? (
                // While the typing pause runs there is no answer yet, so say nothing.
                isPending ? null : (
                    <EmptyState
                        text={query.trim() ? `No videos match "${query.trim()}"` : 'Type a name to search all your folders'}
                    />
                )
            ) : (
                <FlashList
                    data={results}
                    renderItem={renderItem}
                    keyExtractor={(item: VideoFile) => item.path}
                    numColumns={grid ? 2 : 1}
                    key={viewMode}
                    contentContainerStyle={listContentStyle(grid, insets.bottom)}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={handleRefresh}
                            tintColor={theme.colors.primary}
                            colors={[theme.colors.primary]}
                            progressBackgroundColor={theme.colors.cardElevated}
                        />
                    }
                    showsVerticalScrollIndicator={false}
                    keyboardDismissMode="on-drag"
                    keyboardShouldPersistTaps="handled"
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
    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: metrics.space.sm,
        paddingVertical: metrics.space.sm,
        gap: metrics.space.xs,
    },
    // TV overscan: clear of the screen edges.
    barTv: { paddingHorizontal: 48 },
    searchField: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        height: 48,
        paddingLeft: metrics.space.lg,
        paddingRight: metrics.space.xs,
        borderRadius: metrics.radius.pill,
        gap: metrics.space.sm,
    },
    searchInput: { flex: 1, padding: 0 },
});
