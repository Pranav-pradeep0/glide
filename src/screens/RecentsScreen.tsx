// src/screens/RecentsScreen.tsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, StyleSheet, RefreshControl, Alert } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList, VideoHistoryEntry } from '@/types';
import { Loader } from '@/components/Loader';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import { useTheme } from '@/hooks/useTheme';
import { NavigationService } from '@/services/NavigationService';
import { VideoOptionsBottomSheet } from '@/components/VideoOptionsBottomSheet';
import { IconButton, Segmented, SortButton } from '@/components/ui';
import { RecentMusicList } from '@/components/RecentMusicList';
import {
    AmbientBackdrop, ContinueCard, EmptyState, ListHeader, SectionTitle, VideoCard, VideoItemCell, VideoItemComponent, VideoRow,
    deleteVideo, getRelativeTime, joinMeta, listContentStyle, progressOf, shareVideo, timeLabel,
} from '@/components/VideoRow';
import { metrics } from '@/theme/theme';
import { isFinished } from '@/utils/playbackResume';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type ViewMode = 'grid' | 'list';
type RecentsKind = 'videos' | 'music';
const KINDS: { key: RecentsKind; label: string }[] = [{ key: 'videos', label: 'Videos' }, { key: 'music', label: 'Music' }];

type SortByOption = 'recent' | 'views' | 'name';

const SORT_OPTIONS: { key: SortByOption; label: string }[] = [
    { key: 'recent', label: 'Recent' },
    { key: 'views', label: 'Most watched' },
    { key: 'name', label: 'Name' },
];

function sortHistory(items: VideoHistoryEntry[], sortOption: SortByOption): VideoHistoryEntry[] {
    const copy = [...items];
    switch (sortOption) {
        case 'name':
            return copy.sort((a, b) => a.videoName.localeCompare(b.videoName));
        case 'views':
            return copy.sort((a, b) => b.viewCount - a.viewCount);
        default:
            return copy.sort((a, b) => b.lastWatchedTime - a.lastWatchedTime);
    }
}

export default function RecentsScreen() {
    const theme = useTheme();
    const navigation = useNavigation<NavigationProp>();
    const insets = useSafeAreaInsets();

    // Subscribing to the map keeps the list live without reloading on every focus.
    const historyMap = useVideoHistoryStore(s => s.history);
    const isHydrated = useVideoHistoryStore(s => s.isHydrated);
    const hydrateFromStorage = useVideoHistoryStore(s => s.hydrateFromStorage);
    const getAllHistory = useVideoHistoryStore(s => s.getAllHistory);
    const clearVideoHistory = useVideoHistoryStore(s => s.clearVideoHistory);

    const [kind, setKind] = useState<RecentsKind>('videos');
    const [refreshing, setRefreshing] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [sortBy, setSortBy] = useState<SortByOption>('recent');
    const [selectedVideo, setSelectedVideo] = useState<VideoHistoryEntry | null>(null);
    const [optionsVisible, setOptionsVisible] = useState(false);

    useEffect(() => {
        if (!isHydrated) {
            hydrateFromStorage().catch(error => console.error('[RecentsScreen] Hydrate error:', error));
        }
    }, [hydrateFromStorage, isHydrated]);

    // eslint-disable-next-line react-hooks/exhaustive-deps -- historyMap is what getAllHistory reads
    const history = useMemo(() => sortHistory(getAllHistory(), sortBy), [historyMap, getAllHistory, sortBy]);

    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await hydrateFromStorage();
        } catch (error) {
            console.error('[RecentsScreen] Refresh error:', error);
        } finally {
            setRefreshing(false);
        }
    }, [hydrateFromStorage]);

    const handleVideoPress = useCallback((video: VideoHistoryEntry) => {
        if (!video.videoPath) {return;}
        NavigationService.handleVideoNavigation(navigation, video.videoPath, { videoName: video.videoName });
    }, [navigation]);

    const handleOpenOptions = useCallback((video: VideoHistoryEntry) => {
        setSelectedVideo(video);
        setOptionsVisible(true);
    }, []);

    const handleDelete = () => {
        const video = selectedVideo;
        if (!video) {return;}
        // Native resolves a path to its MediaStore entry, so an entry with no saved URI
        // (opened from a file manager) deletes the same way.
        deleteVideo(video.videoName, video.contentUri || video.videoPath).then((deleted) => {
            if (deleted) {clearVideoHistory(video.videoPath);}
        });
    };

    const handleClearHistoryItem = () => {
        const video = selectedVideo;
        if (!video) {return;}
        Alert.alert(`Remove "${video.videoName}" from Recents?`, undefined, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => clearVideoHistory(video.videoPath) },
        ]);
    };

    const grid = viewMode === 'grid';
    // The hero is "what you were just watching", so it only leads the recency order, and
    // only while there's something left of it to continue.
    const latest = sortBy === 'recent' ? history[0] : undefined;
    const hero = latest && !isFinished(latest.lastPausedPosition, latest.duration) ? latest : undefined;
    const rest = hero ? history.slice(1) : history;

    const metaFor = useCallback((item: VideoHistoryEntry) => joinMeta(
        timeLabel(item.duration, item.lastPausedPosition),
        sortBy === 'views'
            ? `${item.viewCount} view${item.viewCount === 1 ? '' : 's'}`
            : getRelativeTime(item.lastWatchedTime),
    ), [sortBy]);

    const renderItem = useCallback(({ item }: { item: VideoHistoryEntry }) => {
        const Item: VideoItemComponent = grid ? VideoCard : VideoRow;
        return (
            <VideoItemCell grid={grid}>
                <Item
                    item={item}
                    path={item.videoPath}
                    name={item.videoName}
                    meta={metaFor(item)}
                    duration={item.duration}
                    progress={progressOf(item.duration, item.lastPausedPosition)}
                    thumbnailTime={item.stopFrameMs}
                    onPress={handleVideoPress}
                    onMore={handleOpenOptions}
                />
            </VideoItemCell>
        );
    }, [grid, metaFor, handleVideoPress, handleOpenOptions]);

    if (!isHydrated) {
        return <Loader fullScreen />;
    }

    const header = (
        <View>
            {hero && (
                <>
                    <SectionTitle title="Continue watching" />
                    <ContinueCard
                        item={hero}
                        path={hero.videoPath}
                        name={hero.videoName}
                        meta={timeLabel(hero.duration, hero.lastPausedPosition) ?? ''}
                        progress={progressOf(hero.duration, hero.lastPausedPosition)}
                        thumbnailTime={hero.stopFrameMs}
                        onPress={handleVideoPress}
                        onMore={handleOpenOptions}
                    />
                </>
            )}
            {rest.length > 0 && <SectionTitle title={hero ? 'Earlier' : 'All videos'} />}
            <SortButton options={SORT_OPTIONS} value={sortBy} onChange={setSortBy} style={styles.sortBar} />
        </View>
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {kind === 'videos' && <AmbientBackdrop path={hero?.videoPath} thumbnailTime={hero?.stopFrameMs} />}
            <View style={{ paddingTop: insets.top }}>
                <ListHeader title="Recents">
                    {kind === 'videos' && (
                        <>
                            <IconButton
                                icon="search"
                                iconSize={20}
                                onPress={() => navigation.navigate('Search')}
                                accessibilityLabel="Search videos"
                            />
                            <IconButton
                                icon={grid ? 'list' : 'grid'}
                                iconSize={20}
                                onPress={() => setViewMode(grid ? 'list' : 'grid')}
                                accessibilityLabel={grid ? 'Switch to list view' : 'Switch to grid view'}
                            />
                        </>
                    )}
                </ListHeader>
                <Segmented options={KINDS} value={kind} onChange={setKind} style={styles.kindRow} />
            </View>

            {kind === 'music' ? (
                <RecentMusicList />
            ) : history.length === 0 ? (
                <EmptyState
                    text="Nothing watched yet"
                    action="Browse videos"
                    onAction={() => navigation.navigate('MainTabs', { screen: 'Folders' })}
                />
            ) : (
                <FlashList
                    data={rest}
                    renderItem={renderItem}
                    keyExtractor={(item: VideoHistoryEntry) => item.videoPath}
                    numColumns={grid ? 2 : 1}
                    key={`${viewMode}-${sortBy}`}
                    extraData={sortBy}
                    ListHeaderComponent={header}
                    contentContainerStyle={listContentStyle(grid)}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={handleRefresh}
                            tintColor={theme.colors.primary}
                            colors={[theme.colors.primary]}
                        />
                    }
                    showsVerticalScrollIndicator={false}
                />
            )}

            <VideoOptionsBottomSheet
                visible={optionsVisible}
                video={selectedVideo}
                onClose={() => setOptionsVisible(false)}
                onPlay={() => selectedVideo && handleVideoPress(selectedVideo)}
                onShare={() => selectedVideo && shareVideo(selectedVideo.contentUri ?? selectedVideo.videoPath)}
                onDelete={handleDelete}
                onClearHistory={handleClearHistoryItem}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    kindRow: { marginHorizontal: metrics.gutter, marginBottom: metrics.space.sm },
        sortBar: { alignSelf: 'flex-end', marginRight: metrics.gutter, marginTop: metrics.space.sm, marginBottom: metrics.space.sm },
});
