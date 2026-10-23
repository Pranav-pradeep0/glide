import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    BackHandler,
    Image,
    RefreshControl,
    ScrollView,
    ScrollViewInstance,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Feather from '@react-native-vector-icons/feather';
import { FlashList } from '@shopify/flash-list';
import { useAudioStore } from '@/store/audioStore';
import { useFavoritesStore } from '@/store/favoritesStore';
import { AudioMediaService, folderPathOf } from '@/services/AudioMediaService';
import { usePermissionStore } from '@/store/permissionStore';
import { PermissionGate } from '@/components/PermissionGate';
import { useTheme } from '@/hooks/useTheme';
import { useAlbumArt } from '@/hooks/useAlbumArt';
import { Button, Chip, IconButton, IconName, SortButton, Touchable } from '@/components/ui';
import { EmptyState, ListHeader } from '@/components/VideoRow';
import { TrackOptionsSheet } from '@/components/TrackOptionsSheet';
import { TrackRow } from '@/components/TrackRow';
import { metrics, type } from '@/theme/theme';
import { AudioAlbum, AudioArtist, AudioFolder, AudioTrack, RootStackParamList } from '@/types';
import { SkeletonList } from '@/components/Skeleton';
import { Pager } from '@/components/Pager';
import { letterJumpIndex } from '@/utils/alphabetIndex';

type LibraryTab = 'tracks' | 'albums' | 'artists' | 'folders' | 'favorites';
/** In page order. */
const TABS: { key: LibraryTab; label: string }[] = [
    { key: 'tracks', label: 'Tracks' },
    { key: 'albums', label: 'Albums' },
    { key: 'artists', label: 'Artists' },
    { key: 'folders', label: 'Folders' },
    { key: 'favorites', label: 'Favorites' },
];
type TrackSortBy = 'title' | 'artist' | 'dateAdded' | 'duration';
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const GRID_HALF_GAP = metrics.space.sm / 2 + 2;
const ALPHABET = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

const SORT_OPTIONS: { key: TrackSortBy; label: string }[] = [
    { key: 'title', label: 'Title (A–Z)' },
    { key: 'artist', label: 'Artist' },
    { key: 'dateAdded', label: 'Recently Added' },
    { key: 'duration', label: 'Duration' },
];

const trackTitle = (t: AudioTrack) => t.title;
const trackArtist = (t: AudioTrack) => t.artist;

const trackCollator =new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function sortTracks(list: AudioTrack[], sortBy: TrackSortBy): AudioTrack[] {
    const sorted = [...list];
    if (sortBy === 'title') {
        sorted.sort((a, b) => trackCollator.compare(a.title, b.title));
    } else if (sortBy === 'artist') {
        sorted.sort((a, b) => trackCollator.compare(a.artist, b.artist));
    } else if (sortBy === 'dateAdded') {
        sorted.sort((a, b) => (b.dateAdded ?? 0) - (a.dateAdded ?? 0));
    } else if (sortBy === 'duration') {
        sorted.sort((a, b) => b.duration - a.duration);
    }
    return sorted;
}

function filterTracks(list: AudioTrack[], query: string): AudioTrack[] {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
        (t) =>
            t.title.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            t.album.toLowerCase().includes(q)
    );
}

// Album card thumbnail with lazy artwork hook
const AlbumCardArt = React.memo(function AlbumCardArtComponent({
    albumId,
    songUri,
    artworkUri: initialArt,
    colors,
}: {
    albumId: string;
    songUri?: string;
    artworkUri?: string | null;
    colors: any;
}) {
    const fetchedArt = useAlbumArt(albumId, songUri);
    const art = initialArt || fetchedArt;

    return (
        <View style={[styles.albumGridArt, { backgroundColor: colors.surfaceVariant }]}>
            {art ? (
                <Image source={{ uri: art }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
                <Feather name="disc" size={28} color={colors.textTertiary} />
            )}
        </View>
    );
});

export default function MusicScreen() {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<NavigationProp>();

    const audioAccess = usePermissionStore((s) => s.audio.access);
    const [activeTab, setActiveTab] = useState<LibraryTab>('tracks');
    const [loading, setLoading] = useState(true);

    // Search and Sort
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<TrackSortBy>('title');

    // Data lists
    const [tracks, setTracks] = useState<AudioTrack[]>([]);
    const [albums, setAlbums] = useState<AudioAlbum[]>([]);
    const [artists, setArtists] = useState<AudioArtist[]>([]);
    const [folders, setFolders] = useState<AudioFolder[]>([]);

    // Selected folder view (for folders tab)
    const [selectedFolder, setSelectedFolder] = useState<AudioFolder | null>(null);

    // Selected track for options sheet
    const [trackWithOptions, setTrackWithOptions] = useState<AudioTrack | null>(null);

    const playTrack = useAudioStore((s) => s.playTrack);
    const playQueue = useAudioStore((s) => s.playQueue);
    const currentTrack = useAudioStore((s) => s.currentTrack);
    const isPlaying = useAudioStore((s) => s.isPlaying);

    const favoriteIds = useFavoritesStore((s) => s.favoriteIds);

    const flashListRef = useRef<any>(null);
    const chipsRef = useRef<ScrollViewInstance>(null);
    const chipsWidth = useRef(0);
    const chipFrames = useRef<{ x: number; width: number }[]>([]);

    // Keeps the active chip in view (centred where the row allows) as a swipe changes it.
    useEffect(() => {
        const frame = chipFrames.current[TABS.findIndex((t) => t.key === activeTab)];
        if (frame) {
            chipsRef.current?.scrollTo({ x: Math.max(0, frame.x + frame.width / 2 - chipsWidth.current / 2), animated: true });
        }
    }, [activeTab]);

    const loadData = useCallback(async (forceRefresh = false) => {
        setLoading(true);
        try {
            const { tracks: songsList, albums: albumsList, artists: artistsList } =
                await AudioMediaService.getLibrary(forceRefresh);

            setTracks(songsList);
            setAlbums(albumsList);
            setArtists(artistsList);
            setFolders(AudioMediaService.groupFolders(songsList));
        } catch (error) {
            console.error('[MusicScreen] Failed to load library:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    // Loads once access is known to be there, and again whenever it is granted (the store
    // has dropped the song cache by then, so this scans afresh).
    useEffect(() => {
        if (audioAccess === 'granted') {
            loadData();
        }
    }, [audioAccess, loadData]);

    // Back inside a folder returns to the folder list, like the header's back arrow.
    useFocusEffect(
        useCallback(() => {
            if (!selectedFolder) return;
            const sub = BackHandler.addEventListener('hardwareBackPress', () => {
                setSelectedFolder(null);
                return true;
            });
            return () => sub.remove();
        }, [selectedFolder])
    );

    const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

    // Pre-sort tracks once when library or sort option changes
    const sortedTracks = useMemo(() => sortTracks(tracks, sortBy), [tracks, sortBy]);

    // The open folder's songs come straight from the loaded library, so they show at once
    // and follow a refresh.
    const sortedFolderTracks = useMemo(
        () => (selectedFolder ? sortedTracks.filter((t) => folderPathOf(t) === selectedFolder.path) : []),
        [sortedTracks, selectedFolder]
    );

    // Fast linear filters without expensive re-sorting on every keystroke. Each page has its
    // own list: a swipe shows the next page's songs before it becomes the active tab.
    const shownTracks = useMemo(() => filterTracks(sortedTracks, searchQuery), [sortedTracks, searchQuery]);
    const shownFavorites = useMemo(
        () => filterTracks(sortedTracks.filter((t) => favoriteSet.has(t.id)), searchQuery),
        [sortedTracks, favoriteSet, searchQuery]
    );
    const shownFolderTracks = useMemo(() => filterTracks(sortedFolderTracks, searchQuery), [sortedFolderTracks, searchQuery]);
    // The songs a tap plays through: the open folder's, or the active page's.
    const displayedTracks = selectedFolder ? shownFolderTracks : activeTab === 'favorites' ? shownFavorites : shownTracks;

    // Filter albums
    const displayedAlbums = useMemo(() => {
        if (!searchQuery.trim()) return albums;
        const q = searchQuery.toLowerCase();
        return albums.filter((a) => a.album.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q));
    }, [albums, searchQuery]);

    // Filter artists
    const displayedArtists = useMemo(() => {
        if (!searchQuery.trim()) return artists;
        const q = searchQuery.toLowerCase();
        return artists.filter((a) => a.artist.toLowerCase().includes(q));
    }, [artists, searchQuery]);

    // Filter folders
    const displayedFolders = useMemo(() => {
        if (!searchQuery.trim()) return folders;
        const q = searchQuery.toLowerCase();
        return folders.filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
    }, [folders, searchQuery]);

    // Play all / Shuffle handler
    const handlePlayAll = useCallback(
        async (list: AudioTrack[], shuffleMode = false) => {
            if (list.length === 0) return;
            const source =
                activeTab === 'favorites'
                    ? 'Favorites'
                    : selectedFolder
                    ? `Folder: ${selectedFolder.name}`
                    : 'Library';

            if (shuffleMode) {
                const randomIndex = Math.floor(Math.random() * list.length);
                useAudioStore.setState({ shuffle: true });
                await playQueue(list, randomIndex, source);
            } else {
                useAudioStore.setState({ shuffle: false });
                await playQueue(list, 0, source);
            }
        },
        [playQueue, activeTab, selectedFolder]
    );

    // Track click: tap playing song opens Now Playing instead of restarting
    const handleSongPress = useCallback(
        (song: AudioTrack) => {
            if (currentTrack?.id === song.id) {
                navigation.navigate('NowPlaying');
                return;
            }
            const source =
                activeTab === 'favorites'
                    ? 'Favorites'
                    : selectedFolder
                    ? `Folder: ${selectedFolder.name}`
                    : 'Library';
            playTrack(song, displayedTracks, source);
        },
        [currentTrack?.id, navigation, playTrack, displayedTracks, activeTab, selectedFolder]
    );

    // A–Z strip: letters only mean something when sorted by a name.
    const letterKey = sortBy === 'title' ? trackTitle : sortBy === 'artist' ? trackArtist : null;
    const handleLetterPress = useCallback(
        (letter: string) => {
            if (!letterKey) return;
            const targetIndex = letterJumpIndex(shownTracks, letter, letterKey);
            if (targetIndex >= 0) {
                flashListRef.current?.scrollToIndex({ index: targetIndex, animated: true });
            }
        },
        [shownTracks, letterKey]
    );

    // Track row renderer
    const renderTrackItem = useCallback(
        ({ item }: { item: AudioTrack }) => (
            <TrackRow
                track={item}
                isCurrent={currentTrack?.id === item.id}
                isPlaying={currentTrack?.id === item.id && isPlaying}
                onPress={handleSongPress}
                onMore={setTrackWithOptions}
            />
        ),
        [currentTrack?.id, isPlaying, handleSongPress]
    );

    // Album card renderer
    const renderAlbumItem = useCallback(
        ({ item }: { item: AudioAlbum }) => (
            <View style={styles.albumGridCell}>
                <Touchable
                    onPress={() =>
                        navigation.navigate('AlbumDetail', {
                            albumId: item.id,
                            albumTitle: item.album,
                            artist: item.artist,
                            artworkUri: item.artworkUri,
                            firstSongUri: item.firstSongUri,
                        })
                    }
                    scaleTo={0.98}
                    style={styles.albumGridCard}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.album} by ${item.artist}`}
                >
                    <AlbumCardArt
                        albumId={item.id}
                        songUri={item.firstSongUri}
                        artworkUri={item.artworkUri}
                        colors={colors}
                    />
                    <View style={styles.albumGridInfo}>
                        <Text style={[type.row, { color: colors.text }]} numberOfLines={1}>
                            {item.album}
                        </Text>
                        <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                            {item.artist} · {item.numberOfSongs} song{item.numberOfSongs !== 1 ? 's' : ''}
                        </Text>
                    </View>
                </Touchable>
            </View>
        ),
        [colors, navigation]
    );

    // Artist row renderer
    const renderArtistItem = useCallback(
        ({ item }: { item: AudioArtist }) => (
            <Touchable
                onPress={() =>
                    navigation.navigate('ArtistDetail', {
                        artistId: item.id,
                        artistName: item.artist,
                    })
                }
                scaleTo={0.98}
                stateLayer
                style={styles.artistRow}
                accessibilityRole="button"
                accessibilityLabel={item.artist}
            >
                <View style={[styles.artistAvatar, { backgroundColor: colors.fillStrong }]}>
                    <Feather name="user" size={22} color={colors.textSecondary} />
                </View>
                <View style={styles.artistInfo}>
                    <Text style={[type.row, { color: colors.text }]} numberOfLines={1}>
                        {item.artist}
                    </Text>
                    <Text style={[type.caption, { color: colors.textSecondary }]}>
                        {item.numberOfAlbums} album{item.numberOfAlbums !== 1 ? 's' : ''} · {item.numberOfTracks} song{item.numberOfTracks !== 1 ? 's' : ''}
                    </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.textTertiary} />
            </Touchable>
        ),
        [colors, navigation]
    );

    // Folder row renderer
    const renderFolderItem = useCallback(
        ({ item }: { item: AudioFolder }) => (
            <Touchable
                onPress={() => setSelectedFolder(item)}
                scaleTo={0.98}
                stateLayer
                style={styles.folderRow}
                accessibilityRole="button"
                accessibilityLabel={item.name}
            >
                <View style={[styles.folderIconWrap, { backgroundColor: colors.fillStrong }]}>
                    <Feather name="folder" size={22} color={colors.textSecondary} />
                </View>
                <View style={styles.folderInfo}>
                    <Text style={[type.row, { color: colors.text }]} numberOfLines={1}>
                        {item.name}
                    </Text>
                    <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                        {item.numberOfSongs} song{item.numberOfSongs !== 1 ? 's' : ''} · {item.path}
                    </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.textTertiary} />
            </Touchable>
        ),
        [colors]
    );

    if (audioAccess === 'denied') {
        return (
            <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
                <ListHeader title="Music" />
                <PermissionGate kind="audio" />
            </View>
        );
    }

    // A search with no matches offers to clear it; an empty library offers a rescan.
    const search = searchQuery.trim();
    const renderEmpty = (icon: IconName, things: string) =>
        search ? (
            <EmptyState
                icon={icon}
                text={`No ${things} match "${search}"`}
                action="Clear search"
                onAction={() => setSearchQuery('')}
            />
        ) : (
            <EmptyState icon={icon} text={`No ${things} found`} action="Refresh" onAction={() => loadData(true)} />
        );

    const counts: Record<LibraryTab, number> = {
        tracks: tracks.length,
        albums: albums.length,
        artists: artists.length,
        folders: folders.length,
        favorites: favoriteIds.length,
    };

    // The spinner's own disc is white by default, which hides a white dark-theme spinner.
    const refreshControl = (
        <RefreshControl
            refreshing={loading}
            onRefresh={() => loadData(true)}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.cardElevated}
        />
    );
    const listContent = { paddingHorizontal: metrics.gutter, paddingBottom: metrics.space.xxl * 2 };

    // Songs with Play All / Shuffle / Sort above them: all songs, favourites, or the open folder's.
    const renderTrackPage = (list: AudioTrack[], page: 'tracks' | 'favorites' | 'folder') => {
        if (list.length === 0) {
            return page === 'favorites' && !search
                ? <EmptyState icon="heart" text="No favorite songs yet" />
                : renderEmpty('music', 'songs');
        }
        return (
            <>
                <View style={styles.actionBar}>
                    <View style={styles.actionButtons}>
                        <Button label="Play All" onPress={() => handlePlayAll(list, false)} icon="play" size="md" />
                        <Button label="Shuffle" onPress={() => handlePlayAll(list, true)} icon="shuffle" variant="secondary" size="md" />
                    </View>
                    <View style={styles.sortGroup}>
                        {/* The Tracks chip already shows the count; elsewhere it gives way to the buttons. */}
                        {page !== 'tracks' && (
                            <Text style={[type.caption, styles.count, { color: colors.textSecondary }]} numberOfLines={1}>
                                {list.length} song{list.length !== 1 ? 's' : ''}
                            </Text>
                        )}
                        <SortButton
                            options={SORT_OPTIONS}
                            value={sortBy}
                            onChange={(key) => setSortBy(key)}
                            title="Sort Tracks"
                        />
                    </View>
                </View>
                <View style={styles.listContainerWithScroller}>
                    <FlashList
                        ref={page === 'tracks' ? flashListRef : undefined}
                        data={list}
                        renderItem={renderTrackItem}
                        keyExtractor={(item) => item.id}
                        contentContainerStyle={listContent}
                        refreshControl={refreshControl}
                        showsVerticalScrollIndicator={false}
                    />

                    {/* A–Z Fast Scroller Column */}
                    {page === 'tracks' && letterKey && !searchQuery && list.length > 20 && (
                        <View style={styles.alphabetIndexCol}>
                            {ALPHABET.map((letter) => (
                                <Touchable
                                    key={letter}
                                    onPress={() => handleLetterPress(letter)}
                                    scaleTo={0.9}
                                    style={styles.alphabetItem}
                                >
                                    <Text style={[styles.alphabetText, { color: colors.textSecondary }]}>
                                        {letter}
                                    </Text>
                                </Touchable>
                            ))}
                        </View>
                    )}
                </View>
            </>
        );
    };

    const renderAlbumsPage = () =>
        displayedAlbums.length === 0 ? (
            renderEmpty('disc', 'albums')
        ) : (
            <FlashList
                data={displayedAlbums}
                renderItem={renderAlbumItem}
                keyExtractor={(item) => item.id}
                numColumns={2}
                contentContainerStyle={{ ...listContent, paddingHorizontal: metrics.gutter - GRID_HALF_GAP }}
                refreshControl={refreshControl}
                showsVerticalScrollIndicator={false}
            />
        );

    const renderArtistsPage = () =>
        displayedArtists.length === 0 ? (
            renderEmpty('user', 'artists')
        ) : (
            <FlashList
                data={displayedArtists}
                renderItem={renderArtistItem}
                keyExtractor={(item) => item.id}
                contentContainerStyle={listContent}
                refreshControl={refreshControl}
                showsVerticalScrollIndicator={false}
            />
        );

    const renderFoldersPage = () =>
        selectedFolder ? (
            renderTrackPage(shownFolderTracks, 'folder')
        ) : displayedFolders.length === 0 ? (
            renderEmpty('folder', 'folders')
        ) : (
            <FlashList
                data={displayedFolders}
                renderItem={renderFolderItem}
                keyExtractor={(item) => item.path}
                contentContainerStyle={listContent}
                refreshControl={refreshControl}
                showsVerticalScrollIndicator={false}
            />
        );

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={{ paddingTop: insets.top }}>
                <ListHeader
                    title={selectedFolder ? selectedFolder.name : 'Music'}
                    subtitle={
                        selectedFolder
                            ? `${sortedFolderTracks.length} song${sortedFolderTracks.length !== 1 ? 's' : ''}`
                            : undefined
                    }
                    onBack={selectedFolder ? () => setSelectedFolder(null) : undefined}
                />
            </View>

            {/* Search Box on Music Tab */}
            <View style={[styles.searchBar, { backgroundColor: colors.fill }]}>
                <Feather name="search" size={18} color={colors.textTertiary} />
                <TextInput
                    style={[styles.searchInput, { color: colors.text }]}
                    placeholder={
                        activeTab === 'tracks'
                            ? 'Search songs by title, artist, album...'
                            : activeTab === 'albums'
                            ? 'Search albums...'
                            : activeTab === 'artists'
                            ? 'Search artists...'
                            : 'Search music...'
                    }
                    placeholderTextColor={colors.textTertiary}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    returnKeyType="search"
                    clearButtonMode="while-editing"
                />
                {searchQuery.length > 0 && (
                    <IconButton
                        icon="x"
                        onPress={() => setSearchQuery('')}
                        accessibilityLabel="Clear search"
                        iconSize={16}
                        style={styles.searchClearBtn}
                    />
                )}
            </View>

            {/* Sub-tab chips; they follow the pager below. */}
            {!selectedFolder && (
                <ScrollView
                    ref={chipsRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.tabChipsScroll}
                    contentContainerStyle={styles.tabChipsRow}
                    onLayout={(e) => { chipsWidth.current = e.nativeEvent.layout.width; }}
                >
                    {TABS.map((t, i) => (
                        <View
                            key={t.key}
                            onLayout={(e) => { chipFrames.current[i] = e.nativeEvent.layout; }}
                        >
                            <Chip
                                label={`${t.label} (${counts[t.key]})`}
                                selected={activeTab === t.key}
                                onPress={() => setActiveTab(t.key)}
                            />
                        </View>
                    ))}
                </ScrollView>
            )}

            {/* Main Content Area */}
            {loading && tracks.length === 0 ? (
                <SkeletonList
                    kind={
                        selectedFolder || activeTab === 'tracks' || activeTab === 'favorites' ? 'track'
                            : activeTab === 'albums' ? 'album'
                            : activeTab === 'artists' ? 'artist'
                            : 'musicFolder'
                    }
                />
            ) : (
                <Pager
                    index={TABS.findIndex((t) => t.key === activeTab)}
                    onIndexChange={(i) => setActiveTab(TABS[i].key)}
                    // Inside a folder the chips are gone and back leaves the folder; a swipe would strand it.
                    scrollEnabled={!selectedFolder}
                    pages={[
                        () => renderTrackPage(shownTracks, 'tracks'),
                        renderAlbumsPage,
                        renderArtistsPage,
                        renderFoldersPage,
                        () => renderTrackPage(shownFavorites, 'favorites'),
                    ]}
                />
            )}

            {/* Song Options Bottom Sheet */}
            <TrackOptionsSheet
                track={trackWithOptions}
                visible={!!trackWithOptions}
                onClose={() => setTrackWithOptions(null)}
                onGoToAlbum={(albumId, albumTitle, artist) => {
                    navigation.navigate('AlbumDetail', { albumId, albumTitle, artist });
                }}
                onGoToArtist={(artistId, artistName) => {
                    navigation.navigate('ArtistDetail', { artistId, artistName });
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: metrics.gutter,
        marginTop: metrics.space.xs,
        marginBottom: metrics.space.md,
        paddingHorizontal: metrics.space.md,
        height: 42,
        borderRadius: metrics.radius.pill,
        gap: metrics.space.sm,
    },
    searchInput: {
        flex: 1,
        paddingVertical: 0,
        fontSize: 14,
    },
    // The 48 dp box overhangs the 42 dp bar; pull it into the padding so the glyph stays put.
    searchClearBtn: { marginRight: -metrics.space.md },
    // Without this a horizontal ScrollView in a column grows to fill the screen's height.
    tabChipsScroll: {
        flexGrow: 0,
    },
    tabChipsRow: {
        flexDirection: 'row',
        paddingHorizontal: metrics.gutter,
        paddingBottom: metrics.space.sm,
        gap: metrics.space.sm,
    },
    actionBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        // Keeps the buttons off the sort group when the row is full.
        gap: metrics.space.sm,
        paddingHorizontal: metrics.gutter,
        paddingVertical: metrics.space.sm,
    },
    count: { flexShrink: 1 },
    // Play All / Shuffle lead; the sort (and count) sit at the right edge.
    sortGroup: {
        flexShrink: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.xs,
    },
    actionButtons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.xs,
    },
    listContainerWithScroller: {
        flex: 1,
        flexDirection: 'row',
    },
    alphabetIndexCol: {
        width: 20,
        alignItems: 'center',
        justifyContent: 'center',
        paddingRight: 2,
    },
    alphabetItem: {
        paddingVertical: 1,
        paddingHorizontal: 2,
    },
    alphabetText: {
        fontSize: 10,
        fontWeight: '600',
    },
    albumGridCell: {
        flex: 1,
        paddingHorizontal: GRID_HALF_GAP,
        paddingBottom: metrics.space.lg,
    },
    albumGridCard: {
        flex: 1,
    },
    albumGridArt: {
        width: '100%',
        aspectRatio: 1,
        borderRadius: metrics.radius.card,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    albumGridInfo: {
        paddingTop: metrics.space.sm,
        gap: 2,
    },
    artistRow: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 64,
        paddingVertical: metrics.space.sm,
        paddingHorizontal: metrics.space.sm,
        borderRadius: metrics.radius.md,
        gap: metrics.space.md,
    },
    artistAvatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    artistInfo: {
        flex: 1,
        gap: 2,
    },
    folderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 64,
        paddingVertical: metrics.space.sm,
        paddingHorizontal: metrics.space.sm,
        borderRadius: metrics.radius.md,
        gap: metrics.space.md,
    },
    folderIconWrap: {
        width: 48,
        height: 48,
        borderRadius: metrics.radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
    },
    folderInfo: {
        flex: 1,
        gap: 2,
    },
});
