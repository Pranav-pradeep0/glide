import React, { useState, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, RefreshControl, Image, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Feather from '@react-native-vector-icons/feather';
import { FlashList } from '@shopify/flash-list';
import { SkeletonList } from '@/components/Skeleton';
import { IconButton, IconName, SortButton, Touchable } from '@/components/ui';
import { EmptyState, ListHeader, SectionTitle, getRelativeTime, joinMeta, listContentStyle } from '@/components/VideoRow';
import { RootStackParamList, VideoFolder } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useAlbums } from '@/hooks/useMediaService';
import { useThumbnail } from '@/hooks/useThumbnails';
import { usePermissionStore } from '@/store/permissionStore';
import { SMB_AVAILABLE, SmbService } from '@/services/SmbService';
import { TELEGRAM_AVAILABLE, TelegramService } from '@/services/TelegramService';
import { PartialAccessBanner, PermissionGate } from '@/components/PermissionGate';
import { metrics, type } from '@/theme/theme';
import { IS_TV } from '@/utils/tv';
import { SourceKind } from '@/utils/videoSource';

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

interface Source {
    key: SourceKind;
    icon: IconName;
    title: string;
    /** What it has now ("2 shares"), or the call to set it up ("Connect"). */
    status: string;
    ready: boolean;
    onPress: () => void;
}

/**
 * Where Glide plays from, so nobody has to guess what an icon means: a tile each, saying what it
 * has or that it is still to connect. Not on TV: its rail already lists them.
 */
function Sources({ albums, onDevice }: { albums: VideoFolder[]; onDevice: () => void }) {
    const { colors } = useTheme();
    const navigation = useNavigation<NavigationProp>();
    const [shares, setShares] = useState(0);
    const [signedIn, setSignedIn] = useState(false);
    // Only what is stored on the phone: Home never waits on the network or starts TDLib.
    useFocusEffect(useCallback(() => {
        setShares(SMB_AVAILABLE ? SmbService.servers().length : 0);
        setSignedIn(TelegramService.signedIn());
    }, []));

    const sources = useMemo(() => {
        const videos = albums.reduce((n, a) => n + a.count, 0);
        const list: Source[] = [{
            key: 'device', icon: 'hard-drive', title: 'Local',
            status: videoCount(videos),
            ready: true,
            onPress: onDevice,
        }];
        if (SMB_AVAILABLE) {
            list.push({
                key: 'network', icon: 'server', title: 'Network',
                status: shares ? `${shares} share${shares !== 1 ? 's' : ''}` : 'Add a share',
                ready: shares > 0,
                onPress: () => navigation.navigate('NetworkShares'),
            });
        }
        if (TELEGRAM_AVAILABLE) {
            list.push({
                key: 'telegram', icon: 'send', title: 'Telegram',
                status: signedIn ? 'Signed in' : 'Connect',
                ready: signedIn,
                onPress: () => navigation.navigate('TelegramHome'),
            });
        }
        return list;
    }, [albums, shares, signedIn, navigation, onDevice]);

    // Only the phone: nothing to discover.
    if (IS_TV || sources.length < 2) { return null; }
    return (
        <View>
            <SectionTitle title="Sources" />
            <View style={styles.tiles}>
                {sources.map(s => (
                    <Touchable
                        key={s.key}
                        onPress={s.onPress}
                        scaleTo={0.97}
                        accessibilityLabel={`${s.title}, ${s.status}`}
                        style={[styles.tile, { backgroundColor: colors.surface }]}
                    >
                        {/* Filled: set up. Tonal: still to connect. */}
                        <View style={[styles.tileIcon, { backgroundColor: s.ready ? colors.primary : colors.fillStrong }]}>
                            <Feather name={s.icon} size={18} color={s.ready ? colors.onPrimary : colors.text} />
                        </View>
                        <Text style={[type.label, { color: colors.text }]} numberOfLines={1}>{s.title}</Text>
                        <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>{s.status}</Text>
                    </Touchable>
                ))}
            </View>
        </View>
    );
}

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
    // Where the folders' title sits in the list header, measured, so Local scrolls exactly to it.
    const foldersY = useRef(0);

    const scrollToFolders = useCallback(() => {
        flashListRef.current?.scrollToOffset({ offset: foldersY.current, animated: true });
    }, []);

    const sort = useCallback((key: SortByOption) => {
        setSortBy(key);
        // The list remounts for the new order; wait a tick so it has it before scrolling to it.
        setTimeout(scrollToFolders, 100);
    }, [scrollToFolders]);

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
        });
    }, [navigation]);

    const grid = viewMode === 'grid';

    // TV starts on the first folder.
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
                <ListHeader title="Home" />
                <SkeletonList kind={grid ? 'folderCard' : 'folder'} />
            </View>
        );
    }

    const pad = listContentStyle(grid).paddingHorizontal;
    const sources = (
        <Sources albums={albums} onDevice={scrollToFolders} />
    );
    // The Sources scroll away with the folders. Bleeds past the list's padding so section
    // titles sit on the screen gutter.
    const { paddingTop } = listContentStyle(grid);
    const header = (
        <View style={{ marginHorizontal: -pad }}>
            {sources}
            {/* y is from the header's top, which sits the list's top padding down. */}
            <View onLayout={e => { foldersY.current = e.nativeEvent.layout.y + paddingTop; }}>
                <SectionTitle title="Local folders">
                    <SortButton options={SORT_OPTIONS} value={sortBy} onChange={sort} />
                </SectionTitle>
            </View>
        </View>
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={{ paddingTop: insets.top }}>
                <ListHeader title="Home">
                    <IconButton
                        icon={grid ? 'list' : 'grid'}
                        onPress={() => setViewMode(grid ? 'list' : 'grid')}
                        accessibilityLabel={grid ? 'Show as list' : 'Show as grid'}
                    />
                </ListHeader>
            </View>

            {/* Shares and Telegram need no storage access, so their way in stays when local videos can't show. */}
            {videoAccess === 'denied' || sortedAlbums.length === 0 ? (
                <ScrollView contentContainerStyle={styles.fill}>
                    {sources}
                    {videoAccess === 'denied'
                        ? <PermissionGate kind="video" />
                        : <EmptyState text="No local videos found" action="Refresh" onAction={refetch} />}
                </ScrollView>
            ) : <>
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
                <FlashList
                    ref={flashListRef}
                    data={sortedAlbums}
                    renderItem={renderAlbum}
                    ListHeaderComponent={header}
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
            </>}

        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    fill: { flexGrow: 1 },
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

    tiles: { flexDirection: 'row', paddingHorizontal: metrics.gutter, gap: metrics.space.sm },
    tile: { flex: 1, padding: metrics.space.md, gap: 2, borderRadius: metrics.radius.lg },
    tileIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: metrics.space.sm,
    },
});
