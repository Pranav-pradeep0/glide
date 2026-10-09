import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import { useTheme } from '@/hooks/useTheme';
import { useAlbumArt } from '@/hooks/useAlbumArt';
import { IconButton, Touchable } from '@/components/ui';
import { metrics, type } from '@/theme/theme';
import { formatDuration } from '@/utils/formatUtils';
import { AudioTrack } from '@/types';

interface TrackRowProps {
    track: AudioTrack;
    isCurrent: boolean;
    /** Whether *this* row is the one playing. Passing the global flag to every row made
     *  the whole visible list re-render on every play/pause. */
    isPlaying: boolean;
    /** Handed the track back, so the list can pass one stable callback to every row. */
    onPress: (track: AudioTrack) => void;
    onMore: (track: AudioTrack) => void;
    /** Second line; defaults to "artist · album". */
    caption?: string;
}

/** A song in a list: cover, title, caption, duration and a menu button. */
export const TrackRow = React.memo(function TrackRowComponent({ track, isCurrent, isPlaying, onPress, onMore, caption }: TrackRowProps) {
    const { colors } = useTheme();
    const fetchedArt = useAlbumArt(track.albumId, track.uri);
    const art = track.artworkUri || fetchedArt;

    return (
        <Touchable
            onPress={() => onPress(track)}
            onLongPress={() => onMore(track)}
            scaleTo={0.98}
            stateLayer
            style={[styles.row, isCurrent && { backgroundColor: colors.primaryContainer }]}
            accessibilityRole="button"
            accessibilityLabel={`${track.title} by ${track.artist}`}
        >
            <View style={[styles.art, { backgroundColor: colors.surfaceVariant }]}>
                {art ? (
                    <Image source={{ uri: art }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                    <Feather
                        name={isCurrent && isPlaying ? 'volume-2' : 'music'}
                        size={18}
                        color={isCurrent ? colors.primary : colors.textTertiary}
                    />
                )}
            </View>

            <View style={styles.info}>
                <Text
                    style={[type.row, { color: isCurrent ? colors.primary : colors.text, fontWeight: isCurrent ? '700' : '400' }]}
                    numberOfLines={1}
                >
                    {track.title}
                </Text>
                <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                    {caption ?? `${track.artist} · ${track.album}`}
                </Text>
            </View>

            <Text style={[type.caption, styles.duration, { color: colors.textTertiary }]}>
                {formatDuration(track.duration)}
            </Text>

            <IconButton icon="more-vertical" onPress={() => onMore(track)} accessibilityLabel="Options" iconSize={16} style={styles.more} />
        </Touchable>
    );
});

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 58,
        paddingVertical: metrics.space.xs,
        paddingHorizontal: metrics.space.sm,
        borderRadius: metrics.radius.md,
        gap: metrics.space.md,
    },
    art: {
        width: 44,
        height: 44,
        borderRadius: metrics.radius.sm,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    info: {
        flex: 1,
        justifyContent: 'center',
        gap: 2,
    },
    duration: {
        fontVariant: ['tabular-nums'],
    },
    more: {
        width: 28,
        height: 28,
    },
});
