import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, RefreshControl, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Feather from '@react-native-vector-icons/feather';
import { FlashList } from '@shopify/flash-list';
import { SkeletonList } from '@/components/Skeleton';
import { IconButton, SortButton, Touchable } from '@/components/ui';
import { EmptyState, ListHeader, getRelativeTime, joinMeta, listContentStyle } from '@/components/VideoRow';
import { RootStackParamList, VideoFolder } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useAlbums } from '@/hooks/useMediaService';
import { useThumbnail } from '@/hooks/useThumbnails';
import { usePermissionStore } from '@/store/permissionStore';
import { PartialAccessBanner, PermissionGate } from '@/components/PermissionGate';
import { metrics, type } from '@/theme/theme';
import { IS_TV } from '@/utils/tv';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const GRID_HALF_GAP = metrics.grid.halfGap;

type ViewMode = 'grid' | 'list';
type SortByOption = 'name' | 'count';

const SORT_OPTIONS: { key: SortByOption; label: string }[] = [
    { key: 'name', label: 'Name' },
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

export default function FoldersScreen() {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<NavigationProp>();

    const { albums, loading, refetch } = useAlbums();
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
            sortBy === 'count' ? b.count - a.count : a.title.localeCompare(b.title)
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

    const renderAlbum = useCallback(({ item, index }: { item: VideoFolder; index: number }) => (
        <View style={grid ? styles.gridCell : styles.listCell}>
            {grid
                ? <AlbumGridCard item={item} onPress={() => handleAlbumPress(item)} preferFocus={index === 0} />
                : <AlbumListItem item={item} onPress={() => handleAlbumPress(item)} preferFocus={index === 0} />}
        </View>
    ), [grid, handleAlbumPress]);

    if (videoAccess === 'unknown' || (loading && albums.length === 0 && videoAccess !== 'denied')) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
                <ListHeader title="Videos" />
                <SkeletonList kind={grid ? 'folderCard' : 'folder'} />
            </View>
        );
    }

    const isEmpty = sortedAlbums.length === 0;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={{ paddingTop: insets.top }}>
                <ListHeader title="Videos">
                    <IconButton
                        icon={grid ? 'list' : 'grid'}
                        onPress={() => setViewMode(grid ? 'list' : 'grid')}
                        accessibilityLabel={grid ? 'Show as list' : 'Show as grid'}
                    />
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
                        <View style={styles.sortBar}>
                            <Text style={[type.caption, { color: theme.colors.textSecondary }]}>
                                {sortedAlbums.length} folder{sortedAlbums.length !== 1 ? 's' : ''}
                            </Text>
                            <SortButton options={SORT_OPTIONS} value={sortBy} onChange={setSortBy} />
                        </View>
                        <FlashList
                            ref={flashListRef}
                            data={sortedAlbums}
                            renderItem={renderAlbum}
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
});
