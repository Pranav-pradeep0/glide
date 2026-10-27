import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, RefreshControl, Image, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Feather from '@react-native-vector-icons/feather';
import { FlashList } from '@shopify/flash-list';
import { SkeletonList } from '@/components/Skeleton';
import { IconButton, SortButton, Touchable } from '@/components/ui';
import {
    EmptyState, ListHeader, SectionTitle, VideoCard, getRelativeTime, joinMeta, listContentStyle, progressOf, timeLabel,
} from '@/components/VideoRow';
import { RootStackParamList, VideoFolder, VideoHistoryEntry } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useAlbums } from '@/hooks/useMediaService';
import { useThumbnail } from '@/hooks/useThumbnails';
import { useMissingHistory } from '@/hooks/useMissingHistory';
import { usePermissionStore } from '@/store/permissionStore';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import { NavigationService } from '@/services/NavigationService';
import { SMB_AVAILABLE } from '@/services/SmbService';
import { PartialAccessBanner, PermissionGate } from '@/components/PermissionGate';
import { metrics, type } from '@/theme/theme';
import { getResumablePosition } from '@/utils/playbackResume';
import { IS_TV } from '@/utils/tv';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const GRID_HALF_GAP = metrics.grid.halfGap;

type ViewMode = 'grid' | 'list';
type SortByOption = 'name' | 'count' | 'date';

const SORT_OPTIONS: { key: SortByOption; label: string }[] = [
    { key: 'name', label: 'Name' },
    { key: 'date', label: 'Newest' },
    { key: 'count', label: 'Most videos' },
];

const videoCount = (n: number) => `${n} video${n !== 1 ? 's' : ''}`;

function Cover({ path, style }: { path?: string; style: object }) {
    const { colors } = useTheme();
    const { thumbnail } = useThumbnail(path);
    return (
        <View style={[styles.cover, { backgroundColor: colors.surfaceVariant }, style]}>
            {thumbnail
                ? <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                : <Feather name="folder" size={24} color={colors.textTertiary} />}
        </View>
    );
}

interface AlbumItemProps {
    item: VideoFolder;
    onPress: () => void;
    /** TV: the first folder takes the D-pad focus. */
    preferFocus?: boolean;
}

/**
 * "42 videos · Added 3 days ago". The count and relative date derived directly from pre-grouped folder metadata.
 */
function getFolderMeta(item: VideoFolder) {
    const added = item.newestTimestamp ? `Added ${getRelativeTime(item.newestTimestamp)}` : undefined;
    return {
        path: item.firstVideoPath || item.firstVideoUri,
        meta: joinMeta(videoCount(item.count), added),
    };
}

const AlbumGridCard = React.memo(({ item, onPress, preferFocus }: AlbumItemProps) => {
    const { colors } = useTheme();
    const folder = useMemo(() => getFolderMeta(item), [item]);
    return (
        <Touchable
            style={styles.gridCard}
            scaleTo={0.98}
            onPress={onPress}
            preferFocus={preferFocus}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${videoCount(item.count)}`}
        >
            <Cover path={folder.path} style={styles.gridCover} />
            <View style={styles.gridInfo}>
                <Text style={[type.row, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
                <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>{folder.meta}</Text>
            </View>
        </Touchable>
    );
});

const AlbumListItem = React.memo(({ item, onPress, preferFocus }: AlbumItemProps) => {
    const { colors } = useTheme();
    const folder = useMemo(() => getFolderMeta(item), [item]);
    return (
        <Touchable
            style={styles.row}
            scaleTo={0.98}
            stateLayer
            onPress={onPress}
            preferFocus={preferFocus}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${videoCount(item.count)}`}
        >
            <Cover path={folder.path} style={styles.rowCover} />
            <View style={styles.rowInfo}>
                <Text style={[type.row, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
                <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>{folder.meta}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.textTertiary} />
        </Touchable>
    );
});

const CONTINUE_LIMIT = 10;
const NO_HISTORY: VideoHistoryEntry[] = [];
const noop = () => {};

/** TV: videos left part-way, last watched first. Always empty on phones. */
function useContinueWatching(): VideoHistoryEntry[] {
    // The player saves history as it plays; the last map is kept while it is on top, so
    // this screen doesn't re-render under it. Regaining focus picks up the latest.
    const isFocused = useIsFocused();
    const shownRef = useRef<Map<string, VideoHistoryEntry> | null>(null);
    const historyMap = useVideoHistoryStore(s => {
        if (!IS_TV) {return null;}
        if (isFocused || !shownRef.current) { shownRef.current = s.history; }
        return shownRef.current;
    });
    const getAllHistory = useVideoHistoryStore(s => s.getAllHistory);
    const { missing } = useMissingHistory(IS_TV);
    return useMemo(() => (historyMap
        ? getAllHistory()
            .filter(e => !missing.has(e.videoPath) && getResumablePosition(e.lastPausedPosition, e.duration) !== null)
            .slice(0, CONTINUE_LIMIT)
        : NO_HISTORY
    ), [historyMap, getAllHistory, missing]);
}

/**
 * TV home pattern: a row of what you were watching above the folders. Cards are one folder
 * column wide, so they line up with the grid and the next one peeks in from the edge.
 * `pad` is the list's side padding; the row bleeds past it so cards scroll off the screen edge.
 */
function ContinueRow({ items, pad }: { items: VideoHistoryEntry[]; pad: number }) {
    const navigation = useNavigation<NavigationProp>();
    const [width, setWidth] = useState(0);
    const play = useCallback((v: VideoHistoryEntry) => {
        NavigationService.handleVideoNavigation(navigation, v.videoPath, { videoName: v.videoName });
    }, [navigation]);
    const cellWidth = (width - 2 * pad) / metrics.grid.columns;
    return (
        <View onLayout={e => setWidth(e.nativeEvent.layout.width)}>
            <SectionTitle title="Continue watching" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.continueContent, { paddingHorizontal: pad }]}>
                {width > 0 && items.map((item, i) => (
                    <View key={item.videoPath} style={[styles.continueCell, { width: cellWidth }]}>
                        <VideoCard
                            item={item}
                            path={item.videoPath}
                            name={item.videoName}
                            meta={timeLabel(item.duration, item.lastPausedPosition) ?? ''}
                            duration={item.duration}
                            progress={progressOf(item.duration, item.lastPausedPosition)}
                            thumbnailTime={item.stopFrameMs}
                            onPress={play}
                            onMore={noop}
                            preferFocus={i === 0}
                        />
                    </View>
                ))}
            </ScrollView>
        </View>
    );
}

export default function FoldersScreen() {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<NavigationProp>();

    const { albums, loading, refetch } = useAlbums();
    const continueItems = useContinueWatching();
    const videoAccess = usePermissionStore((s) => s.video.access);

    // Cards on a TV: bigger targets, and the D-pad moves across as well as down.
    const [viewMode, setViewMode] = useState<ViewMode>(IS_TV ? 'grid' : 'list');
    const [sortBy, setSortBy] = useState<SortByOption>('name');
    const flashListRef = useRef<any>(null);

    useEffect(() => {
        // Wait a tick so the list has the new order before scrolling to it.
        const scrollTimeout = setTimeout(() => {
            flashListRef.current?.scrollToOffset({ offset: 0, animated: true });
        }, 100);
        return () => clearTimeout(scrollTimeout);
    }, [sortBy]);

    const sortedAlbums = useMemo(() => {
        return [...albums].sort((a, b) =>
            sortBy === 'count' ? b.count - a.count
                : sortBy === 'date' ? b.newestTimestamp - a.newestTimestamp
                : a.title.localeCompare(b.title)
        );
    }, [albums, sortBy]);

    const handleAlbumPress = useCallback((album: VideoFolder) => {
        navigation.navigate('AlbumVideos', {
            albumTitle: album.title,
            bucketId: album.id,
            videoCount: album.count,
        });
    }, [navigation]);

    const grid = viewMode === 'grid';

    // TV starts on Continue watching, or the first folder when there is none.
    const focusFirstFolder = continueItems.length === 0;
    const renderAlbum = useCallback(({ item, index }: { item: VideoFolder; index: number }) => (
        <View style={grid ? styles.gridCell : styles.listCell}>
            {grid
                ? <AlbumGridCard item={item} onPress={() => handleAlbumPress(item)} preferFocus={focusFirstFolder && index === 0} />
                : <AlbumListItem item={item} onPress={() => handleAlbumPress(item)} preferFocus={focusFirstFolder && index === 0} />}
        </View>
    ), [grid, handleAlbumPress, focusFirstFolder]);

    if (videoAccess === 'unknown' || (loading && albums.length === 0 && videoAccess !== 'denied')) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
                <ListHeader title="Videos" />
                <SkeletonList kind={grid ? 'folderCard' : 'folder'} />
            </View>
        );
    }

    const isEmpty = sortedAlbums.length === 0;
    const sortBar = (
        <View style={styles.sortBar}>
            <Text style={[type.caption, { color: theme.colors.textSecondary }]}>
                {sortedAlbums.length} folder{sortedAlbums.length !== 1 ? 's' : ''}
            </Text>
            <SortButton options={SORT_OPTIONS} value={sortBy} onChange={setSortBy} />
        </View>
    );
    // TV: Continue watching leads the list and scrolls away with it; the sort bar moves in
    // under it so it stays with the folders it sorts.
    const pad = listContentStyle(grid).paddingHorizontal;
    const tvHeader = IS_TV ? (
        <View style={{ marginHorizontal: -pad }}>
            {continueItems.length > 0 && <ContinueRow items={continueItems} pad={pad} />}
            {sortBar}
        </View>
    ) : undefined;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={{ paddingTop: insets.top }}>
                <ListHeader title="Videos">
                    <IconButton
                        icon={grid ? 'list' : 'grid'}
                        onPress={() => setViewMode(grid ? 'list' : 'grid')}
                        accessibilityLabel={grid ? 'Show as list' : 'Show as grid'}
                    />
                    {/* TV has Network in the rail. */}
                    {!IS_TV && SMB_AVAILABLE && (
                        <IconButton icon="server" onPress={() => navigation.navigate('NetworkShares')} accessibilityLabel="Network shares" />
                    )}
                </ListHeader>
            </View>

            {videoAccess === 'denied' ? <PermissionGate kind="video" /> : <>
                <Touchable
                    onPress={() => navigation.navigate('Search')}
                    accessibilityRole="search"
                    accessibilityLabel="Search all videos"
                    style={[styles.pill, { backgroundColor: theme.colors.cardElevated }]}
                >
                    <Feather name="search" size={18} color={theme.colors.textSecondary} />
                    <Text style={[type.body, { color: theme.colors.textTertiary }]}>Search all videos</Text>
                </Touchable>
                <PartialAccessBanner />

                {isEmpty ? (
                    <EmptyState text="No videos found" action="Refresh" onAction={refetch} />
                ) : (
                    <>
                        {!IS_TV && sortBar}
                        <FlashList
                            ref={flashListRef}
                            data={sortedAlbums}
                            renderItem={renderAlbum}
                            ListHeaderComponent={tvHeader}
                            keyExtractor={(item: VideoFolder) => item.id || item.title}
                            numColumns={grid ? metrics.grid.columns : 1}
                            key={`${viewMode}-${sortBy}`}
                            contentContainerStyle={listContentStyle(grid)}
                            refreshControl={
                                <RefreshControl
                                    refreshing={loading}
                                    onRefresh={refetch}
                                    tintColor={theme.colors.primary}
                                    colors={[theme.colors.primary]}
                                    progressBackgroundColor={theme.colors.cardElevated}
                                />
                            }
                            extraData={viewMode}
                            showsVerticalScrollIndicator={false}
                        />
                    </>
                )}
            </>}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 44,
        marginHorizontal: metrics.gutter,
        marginTop: metrics.space.xs,
        paddingHorizontal: metrics.space.lg,
        borderRadius: metrics.radius.pill,
        gap: metrics.space.sm,
    },
    sortBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: metrics.gutter,
        paddingTop: metrics.space.md,
        paddingBottom: metrics.space.sm,
    },
    cover: {
        borderRadius: metrics.radius.sm,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    listCell: { paddingBottom: 2 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 72,
        gap: metrics.space.md,
        paddingVertical: metrics.space.sm,
        paddingHorizontal: metrics.space.sm,
        borderRadius: metrics.radius.md,
    },
    rowCover: { width: 88, height: 56 },
    rowInfo: { flex: 1, gap: 2 },
    gridCell: { flex: 1, paddingHorizontal: GRID_HALF_GAP, paddingBottom: metrics.space.lg },
    // The radius only shapes the focus ring and tint.
    gridCard: { flex: 1, borderRadius: metrics.radius.sm },
    gridCover: { width: '100%', aspectRatio: 16 / 10 },
    gridInfo: { paddingTop: metrics.space.sm, paddingLeft: 2, gap: 2 },
    // Top room for the focus ring and grow, which the row would otherwise clip.
    continueContent: { paddingTop: metrics.space.md },
    continueCell: { paddingHorizontal: GRID_HALF_GAP, paddingBottom: metrics.space.sm },
});
