import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import { useAudioStore } from '@/store/audioStore';
import { useFavoritesStore } from '@/store/favoritesStore';
import { useTheme } from '@/hooks/useTheme';
import { useAlbumArt } from '@/hooks/useAlbumArt';
import { ListGroup, ListRow, Sheet } from '@/components/ui';
import { metrics, type } from '@/theme/theme';
import { AudioTrack } from '@/types';
import { haptic } from '@/native/HapticModule';

interface TrackOptionsSheetProps {
    track: AudioTrack | null;
    visible: boolean;
    onClose: () => void;
    onGoToAlbum?: (albumId: string, albumTitle: string, artist: string) => void;
    onGoToArtist?: (artistId: string, artistName: string) => void;
}

export function TrackOptionsSheet({
    track: incoming,
    visible,
    onClose,
    onGoToAlbum,
    onGoToArtist,
}: TrackOptionsSheetProps) {
    const { colors } = useTheme();
    // Callers clear the track to close; keep showing it while the sheet slides away.
    const [track, setTrack] = useState(incoming);
    if (incoming && incoming !== track) {
        setTrack(incoming);
    }
    const playNext = useAudioStore((s) => s.playNext);
    const addToQueue = useAudioStore((s) => s.addToQueue);
    const shuffle = useAudioStore((s) => s.shuffle);
    const isFavorite = useFavoritesStore((s) => (track ? s.isFavorite(track.id) : false));
    const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);

    const fetchedArt = useAlbumArt(track?.albumId, track?.uri);
    const artworkUri = track?.artworkUri || fetchedArt;

    if (!track) {
        return null;
    }

    const handlePlayNext = () => {
        haptic('tick');
        playNext(track);
        onClose();
    };

    const handleAddToQueue = () => {
        haptic('tick');
        addToQueue(track);
        onClose();
    };

    const handleToggleFavorite = () => {
        haptic('tick');
        toggleFavorite(track.id);
        onClose();
    };

    const handleGoToAlbum = () => {
        if (onGoToAlbum) {
            onGoToAlbum(track.albumId, track.album, track.artist);
        }
        onClose();
    };

    const handleGoToArtist = () => {
        if (onGoToArtist) {
            onGoToArtist(track.artistId || track.artist, track.artist);
        }
        onClose();
    };

    return (
        <Sheet visible={visible} onClose={onClose} title="Song Options">
            {/* Track Info Card */}
            <View style={[styles.trackCard, { backgroundColor: colors.fill }]}>
                <View style={[styles.artThumb, { backgroundColor: colors.surfaceVariant }]}>
                    {artworkUri ? (
                        <Image source={{ uri: artworkUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    ) : (
                        <Feather name="music" size={20} color={colors.textTertiary} />
                    )}
                </View>
                <View style={styles.trackDetails}>
                    <Text style={[type.row, { color: colors.text }]} numberOfLines={1}>
                        {track.title}
                    </Text>
                    <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                        {track.artist} · {track.album}
                    </Text>
                </View>
            </View>

            {/* Menu Options */}
            <ListGroup inset>
                {!shuffle && (
                    <ListRow
                        title="Play next"
                        caption="Insert right after the current song"
                        icon="corner-down-right"
                        onPress={handlePlayNext}
                    />
                )}
                <ListRow
                    title="Add to queue"
                    caption="Append to the end of the queue"
                    icon="plus-circle"
                    onPress={handleAddToQueue}
                />
                <ListRow
                    title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    icon="heart"
                    onPress={handleToggleFavorite}
                />
                {onGoToAlbum && track.album ? (
                    <ListRow
                        title="Go to album"
                        caption={track.album}
                        icon="disc"
                        chevron
                        onPress={handleGoToAlbum}
                    />
                ) : null}
                {onGoToArtist && track.artist ? (
                    <ListRow
                        title="Go to artist"
                        caption={track.artist}
                        icon="user"
                        chevron
                        onPress={handleGoToArtist}
                    />
                ) : null}
            </ListGroup>
        </Sheet>
    );
}

const styles = StyleSheet.create({
    trackCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: metrics.space.md,
        borderRadius: metrics.radius.md,
        marginBottom: metrics.space.md,
        gap: metrics.space.md,
    },
    artThumb: {
        width: 48,
        height: 48,
        borderRadius: metrics.radius.sm,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    trackDetails: {
        flex: 1,
        justifyContent: 'center',
        gap: 2,
    },
});
