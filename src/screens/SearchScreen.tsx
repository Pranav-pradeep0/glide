// src/screens/SearchScreen.tsx
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
    View,
    TextInput,
    type TextInputInstance,
    StyleSheet,
    RefreshControl,
    Alert,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import Feather from '@react-native-vector-icons/feather';
import { MediaService } from '@/services/MediaService';

import { useTheme } from '@/hooks/useTheme';
import { useVideoSearch } from '@/hooks/useVideoSearch';
import { markAlbumCoverDirty } from '@/hooks/useMediaService';
import { NavigationService } from '@/services/NavigationService';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import { VideoFile, RootStackParamList } from '@/types';
import { formatFileSize } from '@/utils/formatUtils';
import { Loader } from '@/components/Loader';
import { metrics, type } from '@/theme/theme';
import { VideoOptionsBottomSheet } from '@/components/VideoOptionsBottomSheet';
import { IconButton } from '@/components/ui';
import {
    EmptyState, VideoCard, VideoItemCell, VideoItemComponent, VideoRow,
    confirmDelete, joinMeta, listContentStyle, shareVideo,
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
    // ponytail: hides deletions locally; the index catches up on its next sync.
    const [deleted, setDeleted] = useState<Set<string>>(() => new Set());

    const {
        query,
        setQuery,
        results: rawResults,
        isIndexReady,
        clearSearch,
        forceRefresh,
    } = useVideoSearch();

    const results = useMemo(
        () => (deleted.size ? rawResults.filter(v => !deleted.has(v.path)) : rawResults),
        [rawResults, deleted],
    );

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
        const videoUri = video.uri;
        if (!videoUri) {
            Alert.alert('Delete failed', 'Cannot delete: missing media URI.');
            return;
        }
        confirmDelete(video.name, async () => {
            try {
                await MediaService.deleteVideos([videoUri]);
                clearHistoryForPath(video.path);
                if (video.album) {markAlbumCoverDirty(video.album);}
                setDeleted(prev => new Set(prev).add(video.path));
            } catch (error) {
                console.error('[SearchScreen] Delete failed:', error);
                Alert.alert('Delete failed', 'Could not delete the file. Please check permissions.');
            }
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

    if (!isIndexReady) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
                <Loader text="Preparing search" />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
            <View style={styles.bar}>
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

            {results.length === 0 ? (
                <EmptyState
                    text={query.trim() ? `No videos match "${query.trim()}"` : 'Type a name to search all your folders'}
                />
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
