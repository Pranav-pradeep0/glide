import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
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
import { useAlbumPalette } from '@/hooks/useAlbumArt';
import { Button, Gradient, IconButton, Touchable, useSnackbarClearance } from '@/components/ui';
import { TrackOptionsSheet } from '@/components/TrackOptionsSheet';
import { MiniPlayer } from '@/components/MiniPlayer';
import { Loader } from '@/components/Loader';
import { metrics, type } from '@/theme/theme';
import { formatDuration } from '@/utils/formatUtils';
import { AudioTrack, RootStackParamList } from '@/types';

type AlbumDetailRouteProp = RouteProp<RootStackParamList, 'AlbumDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function AlbumDetailScreen() {
    const { colors, dark } = useTheme();
    const insets = useSafeAreaInsets();
    const onMiniPlayerLayout = useSnackbarClearance();
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<AlbumDetailRouteProp>();

    const { albumId, albumTitle, artist, artworkUri: initialArt, firstSongUri } = route.params;

    const [songs, setSongs] = useState<AudioTrack[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTrack, setSelectedTrack] = useState<AudioTrack | null>(null);

    const playTrack = useAudioStore((s) => s.playTrack);
    const playQueue = useAudioStore((s) => s.playQueue);
    const currentTrack = useAudioStore((s) => s.currentTrack);
    const isPlaying = useAudioStore((s) => s.isPlaying);

    const palette = useAlbumPalette(albumId, firstSongUri);
    const artworkUri = initialArt || palette.artworkUri;
    // The cover's colour washes down from the top, so the page belongs to the album instead
    // of being flat black. Dark swatch in dark mode; a light tint of the main one otherwise.
    const tint = dark ? palette.secondaryColor : palette.primaryColor && `${palette.primaryColor}40`;

    // Reloads when access is granted: the store has dropped the song cache by then.
    const audioAccess = usePermissionStore((s) => s.audio.access);
    useEffect(() => {
        let isMounted = true;
        setLoading(true);
        AudioMediaService.getSongsByAlbum(albumId).then((result) => {
            if (isMounted) {
                setSongs(result);
                setLoading(false);
            }
        });
        return () => {
            isMounted = false;
        };
    }, [albumId, audioAccess]);

    const totalDuration = useMemo(() => {
        return songs.reduce((acc, curr) => acc + (curr.duration || 0), 0);
    }, [songs]);

    const handlePlayAll = useCallback(
        (shuffleMode = false) => {
            if (songs.length === 0) return;
            const source = `Album: ${albumTitle}`;
            if (shuffleMode) {
                const randomIndex = Math.floor(Math.random() * songs.length);
                useAudioStore.setState({ shuffle: true });
                playQueue(songs, randomIndex, source);
            } else {
                useAudioStore.setState({ shuffle: false });
                playQueue(songs, 0, source);
            }
        },
        [songs, albumTitle, playQueue]
    );

    const handleSongPress = useCallback(
        (song: AudioTrack) => {
            if (currentTrack?.id === song.id) {
                navigation.navigate('NowPlaying');
                return;
            }
            playTrack(song, songs, `Album: ${albumTitle}`);
        },
        [currentTrack?.id, navigation, playTrack, songs, albumTitle]
    );

    const renderSongItem = useCallback(
        ({ item, index }: { item: AudioTrack; index: number }) => {
            const isCurrent = currentTrack?.id === item.id;
            const trackNum = item.trackNumber > 0 ? item.trackNumber : index + 1;

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
                    <View style={styles.trackNumberCol}>
                        {isCurrent && isPlaying ? (
                            <Feather name="volume-2" size={16} color={colors.primary} />
                        ) : (
                            <Text
                                style={[
                                    type.caption,
                                    { color: isCurrent ? colors.primary : colors.textTertiary, fontVariant: ['tabular-nums'] },
                                ]}
                            >
                                {trackNum}
                            </Text>
                        )}
                    </View>

                    <View style={styles.songInfo}>
                        <Text
                            style={[type.row, { color: isCurrent ? colors.primary : colors.text, fontWeight: isCurrent ? '700' : '400' }]}
                            numberOfLines={1}
                        >
                            {item.title}
                        </Text>
                        <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                            {item.artist}
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
            {!!tint && (
                <Gradient
                    pointerEvents="none"
                    colors={[tint, colors.background]}
                    style={styles.headerWash}
                />
            )}

            {/* Navigation Header */}
            <View style={[styles.navHeader, { paddingTop: insets.top + metrics.space.xs }]}>
                <IconButton
                    icon="chevron-left"
                    onPress={() => navigation.goBack()}
                    accessibilityLabel="Back"
                    iconSize={24}
                />
                <Text style={[type.heading, styles.navTitle, { color: colors.text }]} numberOfLines={1}>
                    {albumTitle}
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
                            {/* Large Cover */}
                            <View style={[styles.coverFrame, { backgroundColor: colors.surfaceVariant, shadowColor: colors.shadow }]}>
                                {artworkUri ? (
                                    <Image source={{ uri: artworkUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                                ) : (
                                    <Feather name="disc" size={64} color={colors.textTertiary} />
                                )}
                            </View>

                            {/* Album Metadata */}
                            <Text style={[type.title, styles.albumTitle, { color: colors.text }]} numberOfLines={2}>
                                {albumTitle}
                            </Text>
                            <Touchable
                                onPress={() => {
                                    if (songs[0]?.artistId || artist) {
                                        navigation.navigate('ArtistDetail', {
                                            artistId: songs[0]?.artistId || artist,
                                            artistName: artist,
                                        });
                                    }
                                }}
                                scaleTo={0.96}
                            >
                                <Text style={[type.row, { color: colors.primary }]} numberOfLines={1}>
                                    {artist}
                                </Text>
                            </Touchable>
                            <Text style={[type.caption, { color: colors.textSecondary }]}>
                                {songs.length} song{songs.length !== 1 ? 's' : ''} · {formatDuration(totalDuration)}
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
                onGoToArtist={(artistId, artistName) => {
                    navigation.navigate('ArtistDetail', { artistId, artistName });
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
    headerWash: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 420,
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
        paddingVertical: metrics.space.lg,
        gap: metrics.space.xs,
    },
    coverFrame: {
        width: 180,
        height: 180,
        borderRadius: metrics.radius.card,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: metrics.space.sm,
        elevation: 6,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 10,
    },
    albumTitle: {
        textAlign: 'center',
        paddingHorizontal: metrics.gutter,
    },
    actionButtons: {
        flexDirection: 'row',
        gap: metrics.space.md,
        marginTop: metrics.space.md,
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
    trackNumberCol: {
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
