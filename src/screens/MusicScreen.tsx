import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    BackHandler,
    Image,
    RefreshControl,
    ScrollView,
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
import { Button, Chip, IconButton, SortButton, Touchable } from '@/components/ui';
import { EmptyState, ListHeader } from '@/components/VideoRow';
import { TrackOptionsSheet } from '@/components/TrackOptionsSheet';
import { TrackRow } from '@/components/TrackRow';
import { metrics, type } from '@/theme/theme';
import { AudioAlbum, AudioArtist, AudioFolder, AudioTrack, RootStackParamList } from '@/types';
import { Loader } from '@/components/Loader';
import { letterJumpIndex } from '@/utils/alphabetIndex';

type LibraryTab = 'tracks' | 'albums' | 'artists' | 'folders' | 'favorites';
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

    // Fast linear filter without expensive re-sorting on every keystroke
    const displayedTracks = useMemo(() => {
        let baseList = sortedTracks;
        if (activeTab === 'favorites') {
            baseList = sortedTracks.filter((t) => favoriteSet.has(t.id));
        } else if (activeTab === 'folders' && selectedFolder) {
            baseList = sortedFolderTracks;
        }

        const q = searchQuery.trim().toLowerCase();
        if (!q) {
            return baseList;
        }

        return baseList.filter(
            (t) =>
                t.title.toLowerCase().includes(q) ||
                t.artist.toLowerCase().includes(q) ||
                t.album.toLowerCase().includes(q)
        );
    }, [sortedTracks, sortedFolderTracks, favoriteSet, activeTab, selectedFolder, searchQuery]);

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
        async (shuffleMode = false) => {
            const list = displayedTracks;
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
        [displayedTracks, playQueue, activeTab, selectedFolder]
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
            const targetIndex = letterJumpIndex(displayedTracks, letter, letterKey);
            if (targetIndex >= 0) {
                flashListRef.current?.scrollToIndex({ index: targetIndex, animated: true });
            }
        },
        [displayedTracks, letterKey]
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

            {/* Segmented Tabs (Tracks, Albums, Artists, Folders, Favorites) */}
            {!selectedFolder && (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.tabChipsScroll}
                    contentContainerStyle={styles.tabChipsRow}
                >
                    <Chip
                        label={`Tracks (${tracks.length})`}
                        selected={activeTab === 'tracks'}
                        onPress={() => setActiveTab('tracks')}
                    />
                    <Chip
                        label={`Albums (${albums.length})`}
                        selected={activeTab === 'albums'}
                        onPress={() => setActiveTab('albums')}
                    />
                    <Chip
                        label={`Artists (${artists.length})`}
                        selected={activeTab === 'artists'}
                        onPress={() => setActiveTab('artists')}
                    />
                    <Chip
                        label={`Folders (${folders.length})`}
                        selected={activeTab === 'folders'}
                        onPress={() => setActiveTab('folders')}
                    />
                    <Chip
                        label={`Favorites (${favoriteIds.length})`}
                        selected={activeTab === 'favorites'}
                        onPress={() => setActiveTab('favorites')}
                    />
                </ScrollView>
            )}

            {/* Quick Actions Bar (Play All / Shuffle / Sort) */}
            {(activeTab === 'tracks' || activeTab === 'favorites' || selectedFolder) && displayedTracks.length > 0 && (
                <View style={styles.actionBar}>
                    <Text style={[type.caption, { color: colors.textSecondary }]}>
                        {displayedTracks.length} song{displayedTracks.length !== 1 ? 's' : ''}
                    </Text>
                    <View style={styles.actionButtons}>
                        <SortButton
                            options={SORT_OPTIONS}
                            value={sortBy}
                            onChange={(key) => setSortBy(key)}
                            title="Sort Tracks"
                        />
                        <Button
                            label="Play All"
                            onPress={() => handlePlayAll(false)}
                            icon="play"
                            size="md"
                        />
                        <Button
                            label="Shuffle"
                            onPress={() => handlePlayAll(true)}
                            icon="shuffle"
                            variant="secondary"
                            size="md"
                        />
                    </View>
                </View>
            )}

            {/* Main Content Area */}
            {loading && tracks.length === 0 ? (
                <Loader />
            ) : activeTab === 'tracks' || activeTab === 'favorites' || selectedFolder ? (
                displayedTracks.length === 0 ? (
                    <EmptyState
                        text={
                            activeTab === 'favorites'
                                ? 'No favorite songs yet'
                                : searchQuery
                                ? 'No matching songs found'
                                : 'No songs found'
                        }
                        action="Refresh"
                        onAction={() => loadData(true)}
                    />
                ) : (
                    <View style={styles.listContainerWithScroller}>
                        {/* Each tab's list gets its own key: FlashList keeps column and size
                            measurements, so reusing one instance across a 2-column grid and
                            1-column lists leaves gaps where the old grid's cells were. */}
                        <FlashList
                            key={selectedFolder ? 'folder-tracks' : activeTab}
                            ref={flashListRef}
                            data={displayedTracks}
                            renderItem={renderTrackItem}
                            keyExtractor={(item) => item.id}
                            contentContainerStyle={{
                                paddingHorizontal: metrics.gutter,
                                paddingBottom: metrics.space.xxl * 2,
                            }}
                            refreshControl={
                                <RefreshControl
                                    refreshing={loading}
                                    onRefresh={() => loadData(true)}
                                    tintColor={colors.primary}
                                    colors={[colors.primary]}
                                />
                            }
                            showsVerticalScrollIndicator={false}
                        />

                        {/* A–Z Fast Scroller Column */}
                        {activeTab === 'tracks' && letterKey && !searchQuery && displayedTracks.length > 20 && (
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
                )
            ) : activeTab === 'albums' ? (
                <FlashList
                    key="albums"
                    data={displayedAlbums}
                    renderItem={renderAlbumItem}
                    keyExtractor={(item) => item.id}
                    numColumns={2}
                    contentContainerStyle={{
                        paddingHorizontal: metrics.gutter - GRID_HALF_GAP,
                        paddingBottom: metrics.space.xxl * 2,
                    }}
                    refreshControl={
                        <RefreshControl
                            refreshing={loading}
                            onRefresh={() => loadData(true)}
                            tintColor={colors.primary}
                        />
                    }
                    showsVerticalScrollIndicator={false}
                />
            ) : activeTab === 'artists' ? (
                <FlashList
                    key="artists"
                    data={displayedArtists}
                    renderItem={renderArtistItem}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={{
                        paddingHorizontal: metrics.gutter,
                        paddingBottom: metrics.space.xxl * 2,
                    }}
                    refreshControl={
                        <RefreshControl
                            refreshing={loading}
                            onRefresh={() => loadData(true)}
                            tintColor={colors.primary}
                        />
                    }
                    showsVerticalScrollIndicator={false}
                />
            ) : (
                <FlashList
                    key="folders"
                    data={displayedFolders}
                    renderItem={renderFolderItem}
                    keyExtractor={(item) => item.path}
                    contentContainerStyle={{
                        paddingHorizontal: metrics.gutter,
                        paddingBottom: metrics.space.xxl * 2,
                    }}
                    refreshControl={
                        <RefreshControl
                            refreshing={loading}
                            onRefresh={() => loadData(true)}
                            tintColor={colors.primary}
                        />
                    }
                    showsVerticalScrollIndicator={false}
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
    searchClearBtn: {
        width: 28,
        height: 28,
    },
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
        paddingHorizontal: metrics.gutter,
        paddingVertical: metrics.space.sm,
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
