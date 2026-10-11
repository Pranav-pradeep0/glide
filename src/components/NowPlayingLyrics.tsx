import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import { Button, IconButton, Touchable } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { useAppStore } from '@/store/appStore';
import { useAudioStore } from '@/store/audioStore';
import { INSTRUMENTAL, isLyricsSynced, withInstrumentalBreaks } from '@/services/LyricsService';
import { LyricLine } from '@/types';
import { metrics, type } from '@/theme/theme';

interface NowPlayingLyricsProps {
    lyrics: LyricLine[] | null;
    accentColor: string;
    isLoading?: boolean;
    onPickLyrics: () => void;
    /** The card on Now Playing, sized to the artwork. Left out: fills its parent (full screen). */
    height?: number;
    /** Card only: opens the full-screen view. */
    onExpand?: () => void;
}

/** Index of the line playing at `position`, or -1 if unsynced or before the first line. */
function activeLineIndex(lyrics: LyricLine[], position: number, isSynced: boolean): number {
    if (!isSynced) { return -1; }
    let active = -1;
    for (let i = 0; i < lyrics.length; i++) {
        if (lyrics[i].time >= 0 && lyrics[i].time <= position) {
            active = i;
        }
    }
    return active;
}

/**
 * Lyrics for Now Playing, as the card in place of the artwork or full screen.
 *
 * Subscribes to the *active line index*, not to `position`: the store's position changes
 * twice a second, the line every few seconds, and only a line change needs a render.
 * Every line has the same size, so the current one changes colour, never the layout.
 */
export const NowPlayingLyrics: React.FC<NowPlayingLyricsProps> = React.memo(({
    lyrics,
    accentColor,
    isLoading,
    onPickLyrics,
    height,
    onExpand,
}) => {
    const { colors } = useTheme();
    const { height: windowHeight } = useWindowDimensions();
    const full = height === undefined;
    const lines = useMemo(() => (lyrics ? withInstrumentalBreaks(lyrics) : []), [lyrics]);
    const isSynced = useMemo(() => isLyricsSynced(lines), [lines]);
    const onlineLyricsEnabled = useAppStore((s) => s.settings.onlineLyricsEnabled);
    const setOnlineLyricsEnabled = useAppStore((s) => s.setOnlineLyricsEnabled);

    const activeLyricIndex = useAudioStore((s) => activeLineIndex(lines, s.position, isSynced));
    const seekTo = useAudioStore((s) => s.seekTo);
    const lyricsListRef = useRef<FlatList<LyricLine>>(null);

    const textStyle = full ? styles.fullText : styles.cardText;
    // Room above the first line and below the last, so either can sit at the centre.
    const edgePadding = (height ?? windowHeight) * 0.4;

    const renderLine = useCallback(({ item: line, index: idx }: { item: LyricLine; index: number }) => {
        if (!isSynced) {
            return (
                <View style={styles.lyricRow}>
                    <Text style={[textStyle, { color: colors.text }]}>{line.text}</Text>
                </View>
            );
        }

        const isActive = idx === activeLyricIndex;
        const isBreak = line.text === INSTRUMENTAL;
        return (
            <Touchable
                onPress={() => seekTo(line.time)}
                style={styles.lyricRow}
                scaleTo={0.98}
                accessibilityLabel={isBreak ? 'Instrumental' : line.text}
            >
                <Text
                    style={[
                        textStyle,
                        isActive
                            ? { color: isBreak ? accentColor : colors.text }
                            : { color: colors.textSecondary, opacity: 0.55 },
                    ]}
                >
                    {line.text}
                </Text>
            </Touchable>
        );
    }, [isSynced, activeLyricIndex, accentColor, colors.text, colors.textSecondary, seekTo, textStyle]);

    const viewPosition = full ? 0.4 : 0.5;
    const scrollRetries = useRef(0);
    useEffect(() => {
        scrollRetries.current = 0;
        if (isSynced && activeLyricIndex >= 0 && lyricsListRef.current) {
            lyricsListRef.current.scrollToIndex({ index: activeLyricIndex, viewPosition, animated: true });
        }
    }, [activeLyricIndex, isSynced, viewPosition]);

    // Opened mid-song, the active line is not measured yet, so the first scroll fails (with an
    // average row height of 0 before anything is laid out). Jump near it, which renders that
    // stretch, then try again.
    const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
        lyricsListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        if (scrollRetries.current >= 3) { return; }
        scrollRetries.current += 1;
        setTimeout(() => {
            lyricsListRef.current?.scrollToIndex({ index: info.index, viewPosition, animated: false });
        }, 50);
    }, [viewPosition]);

    return (
        <View style={full ? styles.fullBox : [styles.cardBox, { height, backgroundColor: colors.fill }]}>
            {isLoading ? (
                <View style={styles.emptyLyricsWrap}>
                    <ActivityIndicator size="small" color={accentColor} />
                    <Text style={[type.caption, { color: colors.textSecondary, textAlign: 'center' }]}>
                        Looking for lyrics…
                    </Text>
                </View>
            ) : lines.length > 0 ? (
                <>
                    <FlatList
                        ref={lyricsListRef}
                        data={lines}
                        keyExtractor={(line, idx) => `${line.time}-${idx}`}
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={{ paddingVertical: isSynced ? edgePadding : metrics.space.lg }}
                        onScrollToIndexFailed={onScrollToIndexFailed}
                        renderItem={renderLine}
                        extraData={activeLyricIndex}
                    />
                    {onExpand && (
                        <IconButton
                            icon="maximize-2"
                            iconSize={18}
                            onPress={onExpand}
                            accessibilityLabel="Full-screen lyrics"
                            style={styles.expand}
                        />
                    )}
                </>
            ) : (
                <View style={styles.emptyLyricsWrap}>
                    <Feather name="file-text" size={32} color={colors.textTertiary} />
                    <Text style={[type.caption, { color: colors.textSecondary, textAlign: 'center' }]}>
                        {onlineLyricsEnabled
                            ? 'No lyrics found'
                            : 'No lyrics on this device. Online lyrics are off, so Glide didn’t look them up.'}
                    </Text>
                    {!onlineLyricsEnabled && (
                        <Button
                            label="Turn on online lyrics"
                            icon="globe"
                            size="md"
                            onPress={() => setOnlineLyricsEnabled(true)}
                        />
                    )}
                    <Button
                        label="Load lyrics…"
                        icon="upload"
                        variant="secondary"
                        size="md"
                        onPress={onPickLyrics}
                    />
                </View>
            )}
        </View>
    );
});

const styles = StyleSheet.create({
    cardBox: {
        width: '100%',
        borderRadius: metrics.radius.card,
        overflow: 'hidden',
        paddingHorizontal: metrics.space.md,
    },
    fullBox: {
        flex: 1,
        paddingHorizontal: metrics.gutter,
    },
    lyricRow: {
        paddingVertical: metrics.space.sm,
        paddingHorizontal: metrics.space.sm,
        borderRadius: metrics.radius.sm,
    },
    cardText: {
        textAlign: 'center',
        fontSize: 20,
        lineHeight: 28,
        fontWeight: '700',
    },
    fullText: {
        fontSize: 28,
        lineHeight: 38,
        fontWeight: '700',
    },
    expand: {
        position: 'absolute',
        top: metrics.space.xs,
        right: metrics.space.xs,
    },
    emptyLyricsWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: metrics.space.md,
        paddingHorizontal: metrics.space.lg,
    },
});

export default NowPlayingLyrics;
