// src/screens/RecentsScreen.tsx
import React, { useState, useMemo, useCallback, useRef } from 'react';
import { View, StyleSheet, RefreshControl } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { RootStackParamList, VideoHistoryEntry } from '@/types';
import { replayParams, useVideoHistoryStore } from '@/store/videoHistoryStore';
import { useTheme } from '@/hooks/useTheme';
import { useMissingHistory } from '@/hooks/useMissingHistory';
import { NavigationService } from '@/services/NavigationService';
import { VideoOptionsBottomSheet } from '@/components/VideoOptionsBottomSheet';
import { IconButton, Segmented, showDialog, SortButton } from '@/components/ui';
import { RecentMusicList } from '@/components/RecentMusicList';
import { Pager } from '@/components/Pager';
import {
    AmbientBackdrop, ContinueCard, EmptyState, ListHeader, SectionTitle, VideoCard, VideoItemCell, VideoItemComponent, VideoRow,
    deleteVideo, getRelativeTime, joinMeta, listContentStyle, progressOf, shareVideo, timeLabel,
} from '@/components/VideoRow';
import { metrics } from '@/theme/theme';
import { isFinished } from '@/utils/playbackResume';
import { IS_TV } from '@/utils/tv';
import { withDays } from '@/utils/videoSource';

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

    // Subscribing to the map keeps the list live without reloading on every focus. While
    // another screen is on top (the player saves history as it plays) the last map is kept,
    // so this tab does not re-render under it; regaining focus picks up the latest.
    const isFocused = useIsFocused();
    const shownHistoryRef = useRef<Map<string, VideoHistoryEntry> | null>(null);
    const historyMap = useVideoHistoryStore(s => {
        if (isFocused || !shownHistoryRef.current) { shownHistoryRef.current = s.history; }
        return shownHistoryRef.current;
    });
    const getAllHistory = useVideoHistoryStore(s => s.getAllHistory);
    const clearVideoHistory = useVideoHistoryStore(s => s.clearVideoHistory);

    const [kind, setKind] = useState<RecentsKind>('videos');
    // 0 on Videos, 1 on Music, in between mid-swipe.
    const kindPosition = useSharedValue(0);
    const backdropStyle = useAnimatedStyle(() => ({ opacity: 1 - kindPosition.value }));
    const [refreshing, setRefreshing] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [sortBy, setSortBy] = useState<SortByOption>('recent');
    const [selectedVideo, setSelectedVideo] = useState<VideoHistoryEntry | null>(null);
    const [optionsVisible, setOptionsVisible] = useState(false);

    const { missing, check: checkMissing } = useMissingHistory();

    const history = useMemo(
        () => sortHistory(getAllHistory().filter(e => !missing.has(e.videoPath)), sortBy),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- historyMap is what getAllHistory reads
        [historyMap, getAllHistory, sortBy, missing],
    );

    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await checkMissing(true);
        } catch (error) {
            console.error('[RecentsScreen] Refresh error:', error);
        } finally {
            setRefreshing(false);
        }
    }, [checkMissing]);

    const handleVideoPress = useCallback((video: VideoHistoryEntry) => {
        if (!video.videoPath) {return;}
        NavigationService.handleVideoNavigation(navigation, video.videoPath, replayParams(video));
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
        showDialog(`Remove "${video.videoName}" from Recents?`, undefined, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => clearVideoHistory(video.videoPath) },
        ]);
    };

    const selectedLocal = !!selectedVideo && !NavigationService.isNetworkStream(selectedVideo.videoPath);

    const grid = viewMode === 'grid';
    // The hero is "what you were just watching", so it only leads the recency order, and
    // only while there's something left of it to continue.
    const latest = sortBy === 'recent' ? history[0] : undefined;
    const hero = latest && !isFinished(latest.lastPausedPosition, latest.duration) ? latest : undefined;
    const data = useMemo(() => {
        const rest = hero ? history.slice(1) : history;
        return sortBy === 'recent' ? withDays(rest) : rest;
    }, [history, hero, sortBy]);
    // TV starts on the hero, or the first video when there is none.
    const firstVideo = hero ? -1 : data.findIndex(i => typeof i !== 'string');
    const pad = listContentStyle(grid).paddingHorizontal;

    const metaFor = useCallback((item: VideoHistoryEntry) => joinMeta(
        timeLabel(item.duration, item.lastPausedPosition),
        sortBy === 'views'
            ? `${item.viewCount} view${item.viewCount === 1 ? '' : 's'}`
            : getRelativeTime(item.lastWatchedTime),
    ), [sortBy]);

    const renderItem = useCallback(({ item, index }: { item: VideoHistoryEntry | string; index: number }) => {
        if (typeof item === 'string') {
            return <View style={{ marginHorizontal: -pad }}><SectionTitle title={item} /></View>;
        }
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
                    source
                    onPress={handleVideoPress}
                    onMore={handleOpenOptions}
                    preferFocus={index === firstVideo}
                />
            </VideoItemCell>
        );
    }, [grid, metaFor, handleVideoPress, handleOpenOptions, firstVideo, pad]);

    const sort = <SortButton options={SORT_OPTIONS} value={sortBy} onChange={setSortBy} />;
    const header = (
        <View style={{ marginHorizontal: -pad }}>
            {/* With a video to continue, the sort sits on its title's line: no row just for it. */}
            {!hero && <View style={styles.filterBar}>
                <View style={styles.chipScroll} />
                {sort}
            </View>}
            {hero && <>
                <SectionTitle title="Continue watching">{sort}</SectionTitle>
                <ContinueCard
                    item={hero}
                    path={hero.videoPath}
                    name={hero.videoName}
                    meta={timeLabel(hero.duration, hero.lastPausedPosition) ?? ''}
                    progress={progressOf(hero.duration, hero.lastPausedPosition)}
                    thumbnailTime={hero.stopFrameMs}
                    source
                    onPress={handleVideoPress}
                    onMore={handleOpenOptions}
                    preferFocus
                />
                <View style={styles.heroGap} />
            </>}
        </View>
    );

    const renderVideos = () => (history.length === 0 ? (
        <EmptyState
            text="Nothing watched yet"
            action="Browse videos"
            onAction={() => navigation.navigate('MainTabs', { screen: 'Folders' })}
        />
    ) : (
        <FlashList
            data={data}
            renderItem={renderItem}
            keyExtractor={(item: VideoHistoryEntry | string) => (typeof item === 'string' ? `day:${item}` : item.videoPath)}
            getItemType={(item: VideoHistoryEntry | string) => (typeof item === 'string' ? 'day' : 'video')}
            // A day heading spans the grid.
            overrideItemLayout={(layout: { span?: number }, item: VideoHistoryEntry | string) => {
                if (typeof item === 'string') { layout.span = 2; }
            }}
            numColumns={grid ? 2 : 1}
            key={`${viewMode}-${sortBy}`}
            ListHeaderComponent={header}
            contentContainerStyle={listContentStyle(grid)}
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
        />
    ));
    const renderMusic = () => <RecentMusicList />;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]} pointerEvents="none">
                <AmbientBackdrop path={hero?.videoPath} thumbnailTime={hero?.stopFrameMs} />
            </Animated.View>
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
                {/* TV is videos only for now: no music page. */}
                {!IS_TV && <Segmented options={KINDS} value={kind} onChange={setKind} position={kindPosition} style={styles.kindRow} />}
            </View>

            {IS_TV ? <View style={styles.container}>{renderVideos()}</View> : (
                <Pager
                    index={KINDS.findIndex(k => k.key === kind)}
                    onIndexChange={i => setKind(KINDS[i].key)}
                    position={kindPosition}
                    pages={[renderVideos, renderMusic]}
                />
            )}

            <VideoOptionsBottomSheet
                visible={optionsVisible}
                video={selectedVideo}
                onClose={() => setOptionsVisible(false)}
                onPlay={() => selectedVideo && handleVideoPress(selectedVideo)}
                // A share or an app link: nothing on this device to share or delete.
                onShare={selectedLocal ? () => shareVideo(selectedVideo.contentUri ?? selectedVideo.videoPath) : undefined}
                onDelete={selectedLocal ? handleDelete : undefined}
                onClearHistory={handleClearHistoryItem}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    kindRow: { marginHorizontal: metrics.gutter, marginBottom: metrics.space.sm },
    filterBar: { flexDirection: 'row', alignItems: 'center', gap: metrics.space.sm, paddingRight: metrics.gutter, paddingVertical: metrics.space.sm },
    chipScroll: { flex: 1 },
    heroGap: { height: metrics.space.lg },
});
