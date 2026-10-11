import React, { useState, useEffect, useCallback } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Feather from '@react-native-vector-icons/feather';
import { FlashList } from '@shopify/flash-list';
import { useAudioStore } from '@/store/audioStore';
import { usePermissionStore } from '@/store/permissionStore';
import { PermissionGate } from '@/components/PermissionGate';
import { AudioMediaService } from '@/services/AudioMediaService';
import { useTheme } from '@/hooks/useTheme';
import { useAlbumArt } from '@/hooks/useAlbumArt';
import { Button, IconButton, Touchable, useSnackbarClearance } from '@/components/ui';
import { TrackOptionsSheet } from '@/components/TrackOptionsSheet';
import { MiniPlayer } from '@/components/MiniPlayer';
import { Loader } from '@/components/Loader';
import { metrics, type } from '@/theme/theme';
import { formatDuration } from '@/utils/formatUtils';
import { AudioAlbum, AudioTrack, RootStackParamList } from '@/types';

type ArtistDetailRouteProp = RouteProp<RootStackParamList, 'ArtistDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const AlbumCardHorizontal = React.memo(function AlbumCardHorizontalComponent({
    album,
    onPress,
    colors,
}: {
    album: AudioAlbum;
    onPress: () => void;
    colors: any;
}) {
    const art = useAlbumArt(album.id, album.firstSongUri);
    const artworkUri = album.artworkUri || art;

    return (
        <Touchable
            onPress={onPress}
            scaleTo={0.96}
            style={styles.albumMiniCard}
            accessibilityRole="button"
            accessibilityLabel={`${album.album}`}
        >
            <View style={[styles.albumMiniArt, { backgroundColor: colors.surfaceVariant }]}>
                {artworkUri ? (
                    <Image source={{ uri: artworkUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                    <Feather name="disc" size={24} color={colors.textTertiary} />
                )}
            </View>
            <Text style={[type.row, { color: colors.text }]} numberOfLines={1}>
                {album.album}
            </Text>
            <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                {album.numberOfSongs} song{album.numberOfSongs !== 1 ? 's' : ''}
            </Text>
        </Touchable>
    );
});

export default function ArtistDetailScreen() {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const onMiniPlayerLayout = useSnackbarClearance();
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<ArtistDetailRouteProp>();

    const { artistId, artistName } = route.params;

    const [songs, setSongs] = useState<AudioTrack[]>([]);
    const [albums, setAlbums] = useState<AudioAlbum[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTrack, setSelectedTrack] = useState<AudioTrack | null>(null);

    const playTrack = useAudioStore((s) => s.playTrack);
    const playQueue = useAudioStore((s) => s.playQueue);
    const currentTrack = useAudioStore((s) => s.currentTrack);
    const isPlaying = useAudioStore((s) => s.isPlaying);

    // Reloads when access is granted: the store has dropped the song cache by then.
    const audioAccess = usePermissionStore((s) => s.audio.access);
    useEffect(() => {
        let isMounted = true;
        setLoading(true);
        AudioMediaService.getSongsByArtist(artistId).then((result) => {
            if (isMounted) {
                setSongs(result);
                setAlbums(AudioMediaService.groupAlbums(result));
                setLoading(false);
            }
        });
        return () => {
            isMounted = false;
        };
    }, [artistId, audioAccess]);

    const handlePlayAll = useCallback(
        (shuffleMode = false) => {
            if (songs.length === 0) return;
            const source = `Artist: ${artistName}`;
            if (shuffleMode) {
                const randomIndex = Math.floor(Math.random() * songs.length);
                useAudioStore.setState({ shuffle: true });
                playQueue(songs, randomIndex, source);
            } else {
                useAudioStore.setState({ shuffle: false });
                playQueue(songs, 0, source);
            }
        },
        [songs, artistName, playQueue]
    );

    const handleSongPress = useCallback(
        (song: AudioTrack) => {
            if (currentTrack?.id === song.id) {
                navigation.navigate('NowPlaying');
                return;
            }
            playTrack(song, songs, `Artist: ${artistName}`);
        },
        [currentTrack?.id, navigation, playTrack, songs, artistName]
    );

    const handleAlbumPress = useCallback(
        (album: AudioAlbum) => {
            navigation.navigate('AlbumDetail', {
                albumId: album.id,
                albumTitle: album.album,
                artist: album.artist,
                artworkUri: album.artworkUri,
                firstSongUri: album.firstSongUri,
            });
        },
        [navigation]
    );

    const renderSongItem = useCallback(
        ({ item }: { item: AudioTrack }) => {
            const isCurrent = currentTrack?.id === item.id;
            return (
                <Touchable
                    onPress={() => handleSongPress(item)}
                    onLongPress={() => setSelectedTrack(item)}
                    scaleTo={0.98}
                    stateLayer
                    style={[styles.songRow, isCurrent && { backgroundColor: colors.primaryContainer }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title} by ${item.artist}`}
                >
                    <View style={styles.songLeadingIcon}>
                        <Feather
                            name={isCurrent && isPlaying ? 'volume-2' : 'music'}
                            size={16}
                            color={isCurrent ? colors.primary : colors.textTertiary}
                        />
                    </View>

                    <View style={styles.songInfo}>
                        <Text
                            style={[type.row, { color: isCurrent ? colors.primary : colors.text, fontWeight: isCurrent ? '700' : '400' }]}
                            numberOfLines={1}
                        >
                            {item.title}
                        </Text>
                        <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                            {item.album}
                        </Text>
                    </View>

                    <Text style={[type.caption, styles.durationText, { color: colors.textTertiary }]}>
                        {formatDuration(item.duration)}
                    </Text>

                    <IconButton
                        icon="more-vertical"
                        onPress={() => setSelectedTrack(item)}
                        accessibilityLabel="Song options"
                        iconSize={16}
                        style={styles.moreBtn}
                    />
                </Touchable>
            );
        },
        [currentTrack?.id, isPlaying, colors, handleSongPress]
    );

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Navigation Header */}
            <View style={[styles.navHeader, { paddingTop: insets.top + metrics.space.xs }]}>
                <IconButton
                    icon="chevron-left"
                    onPress={() => navigation.goBack()}
                    accessibilityLabel="Back"
                    iconSize={24}
                />
                <Text style={[type.heading, styles.navTitle, { color: colors.text }]} numberOfLines={1}>
                    {artistName}
                </Text>
                <View style={{ width: 40 }} />
            </View>

            {audioAccess === 'denied' ? (
                <PermissionGate kind="audio" />
            ) : loading ? (
                <Loader />
            ) : (
                <FlashList
                    data={songs}
                    renderItem={renderSongItem}
                    keyExtractor={(item) => item.id}
                    ListHeaderComponent={
                        <View style={styles.heroHeader}>
                            {/* Artist Avatar */}
                            <View style={[styles.avatarFrame, { backgroundColor: colors.primaryContainer }]}>
                                <Feather name="user" size={48} color={colors.primary} />
                            </View>

                            <Text style={[type.title, styles.artistTitle, { color: colors.text }]} numberOfLines={1}>
                                {artistName}
                            </Text>

                            <Text style={[type.caption, { color: colors.textSecondary }]}>
                                {albums.length} album{albums.length !== 1 ? 's' : ''} · {songs.length} song{songs.length !== 1 ? 's' : ''}
                            </Text>

                            {/* Action Buttons */}
                            <View style={styles.actionButtons}>
                                <Button
                                    label="Play All"
                                    icon="play"
                                    onPress={() => handlePlayAll(false)}
                                    size="md"
                                />
                                <Button
                                    label="Shuffle"
                                    icon="shuffle"
                                    variant="secondary"
                                    onPress={() => handlePlayAll(true)}
                                    size="md"
                                />
                            </View>

                            {/* Albums Carousel */}
                            {albums.length > 0 && (
                                <View style={styles.albumsSection}>
                                    <Text style={[type.heading, styles.sectionTitle, { color: colors.text }]}>
                                        Albums
                                    </Text>
                                    <FlatList
                                        horizontal
                                        data={albums}
                                        keyExtractor={(item) => item.id}
                                        renderItem={({ item }) => (
                                            <AlbumCardHorizontal
                                                album={item}
                                                onPress={() => handleAlbumPress(item)}
                                                colors={colors}
                                            />
                                        )}
                                        showsHorizontalScrollIndicator={false}
                                        contentContainerStyle={styles.albumsList}
                                    />
                                </View>
                            )}

                            <Text style={[type.heading, styles.sectionTitle, { color: colors.text, alignSelf: 'flex-start', paddingHorizontal: metrics.gutter, marginTop: metrics.space.md }]}>
                                Songs
                            </Text>
                        </View>
                    }
                    contentContainerStyle={{
                        paddingHorizontal: metrics.gutter,
                        paddingBottom: metrics.space.xxl * 2,
                    }}
                    showsVerticalScrollIndicator={false}
                />
            )}

            {/* Song Options Bottom Sheet */}
            <TrackOptionsSheet
                track={selectedTrack}
                visible={!!selectedTrack}
                onClose={() => setSelectedTrack(null)}
                onGoToAlbum={(albumId, albumTitle, artist) => {
                    navigation.navigate('AlbumDetail', { albumId, albumTitle, artist });
                }}
            />

            {/* Sticky Mini Player */}
            <View style={{ paddingBottom: insets.bottom }} onLayout={onMiniPlayerLayout}>
                <MiniPlayer />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    navHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: metrics.gutter,
        minHeight: 52,
    },
    navTitle: {
        flex: 1,
        textAlign: 'center',
        marginHorizontal: metrics.space.sm,
    },
    heroHeader: {
        alignItems: 'center',
        paddingVertical: metrics.space.md,
        gap: metrics.space.xs,
    },
    avatarFrame: {
        width: 100,
        height: 100,
        borderRadius: 50,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: metrics.space.xs,
    },
    artistTitle: {
        textAlign: 'center',
    },
    actionButtons: {
        flexDirection: 'row',
        gap: metrics.space.md,
        marginTop: metrics.space.sm,
        marginBottom: metrics.space.md,
    },
    albumsSection: {
        width: '100%',
        marginTop: metrics.space.sm,
    },
    sectionTitle: {
        paddingHorizontal: metrics.gutter,
        marginBottom: metrics.space.sm,
    },
    albumsList: {
        paddingHorizontal: metrics.gutter,
        gap: metrics.space.md,
    },
    albumMiniCard: {
        width: 120,
        gap: 2,
    },
    albumMiniArt: {
        width: 120,
        height: 120,
        borderRadius: metrics.radius.card,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 4,
    },
    songRow: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 56,
        paddingVertical: metrics.space.xs,
        paddingHorizontal: metrics.space.xs,
        borderRadius: metrics.radius.md,
        gap: metrics.space.sm,
    },
    songLeadingIcon: {
        width: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
    songInfo: {
        flex: 1,
        gap: 2,
    },
    durationText: {
        fontVariant: ['tabular-nums'],
    },
    moreBtn: {
        width: 32,
        height: 32,
    },
});
