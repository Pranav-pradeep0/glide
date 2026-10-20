import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View, type HostInstance } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Feather from '@react-native-vector-icons/feather';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { makeMutable, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useAudioStore } from '@/store/audioStore';
import { useTheme } from '@/hooks/useTheme';
import { useAlbumPalette } from '@/hooks/useAlbumArt';
import { IconButton, Touchable, showSnackbar } from '@/components/ui';
import { metrics, motion, type } from '@/theme/theme';
import { RootStackParamList } from '@/types';
import { haptic } from '@/native/HapticModule';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

/**
 * Where the visible mini player sits, in window coordinates. Now Playing grows out of the
 * bar and its cover, and shrinks back into them, so the two read as one surface.
 * Written by whichever mini player is on the focused screen; width 0 means not measured yet.
 */
export const miniArtRect = { x: 0, y: 0, width: 0, height: 0 };
export const miniBarRect = { x: 0, y: 0, width: 0, height: 0 };

/** The floating card's corner radius; Now Playing's collapse rounds to the same value. */
export const MINI_CARD_RADIUS = metrics.radius.md;

/**
 * The card's colour. In dark mode the cover's dark swatch, so the card belongs to the song; in
 * light mode the raised surface, where a dark card would fight the page. Shared with Now
 * Playing so the collapse lands on exactly this colour.
 */
export function miniCardColor(dark: boolean, raisedSurface: string, coverDark: string | null) {
    return dark && coverDark ? coverDark : raisedSurface;
}

/**
 * How open Now Playing is: 0 is the mini player, 1 is full screen. Now Playing drives it; the
 * tab bar reads it to slide out of the way in step, so the player never covers the tabs and
 * then suddenly uncovers them.
 */
export const playerExpansion = makeMutable(0);

const MiniPlayerProgressBar = React.memo(() => {
    const { colors } = useTheme();
    const position = useAudioStore((s) => s.position);
    const duration = useAudioStore((s) => s.duration);
    const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

    return (
        <View style={[styles.progressTrack, { backgroundColor: colors.fillStrong }]}>
            <View style={[styles.progressBar, { width: `${progress * 100}%`, backgroundColor: colors.text }]} />
        </View>
    );
});

export function MiniPlayer() {
    const { colors, dark } = useTheme();
    const navigation = useNavigation<NavigationProp>();
    const currentTrack = useAudioStore((s) => s.currentTrack);
    const isPlaying = useAudioStore((s) => s.isPlaying);
    const isBuffering = useAudioStore((s) => s.isBuffering);
    const togglePlayPause = useAudioStore((s) => s.togglePlayPause);
    const skipNext = useAudioStore((s) => s.skipNext);
    const skipPrevious = useAudioStore((s) => s.skipPrevious);

    const palette = useAlbumPalette(currentTrack?.albumId, currentTrack?.uri);
    const artworkUri = currentTrack?.artworkUri || palette.artworkUri;
    const cardColor = miniCardColor(dark, colors.cardElevated, palette.secondaryColor);

    // The tab bar and the album/artist screens each have a mini player; only the focused one
    // is the one Now Playing collapses onto.
    const isFocused = useIsFocused();
    const artRef = useRef<HostInstance>(null);
    const barRef = useRef<HostInstance>(null);
    const measureArt = useCallback(() => {
        if (!isFocused) return;
        artRef.current?.measureInWindow((x, y, width, height) => {
            if (width > 0) Object.assign(miniArtRect, { x, y, width, height });
        });
        barRef.current?.measureInWindow((x, y, width, height) => {
            if (height > 0) Object.assign(miniBarRect, { x, y, width, height });
        });
    }, [isFocused]);
    const hasTrack = !!currentTrack;
    useEffect(() => {
        if (hasTrack) requestAnimationFrame(measureArt);
    }, [hasTrack, measureArt]);

    const handlePress = useCallback(() => {
        navigation.navigate('NowPlaying');
    }, [navigation]);

    const handleSkipNext = useCallback(() => {
        haptic('tick');
        skipNext();
    }, [skipNext]);

    const handleSkipPrev = useCallback(() => {
        haptic('tick');
        skipPrevious();
    }, [skipPrevious]);

    // Swipe down stops playback and clears the queue, with Undo: the bar sits just above the
    // tabs, where a stray downward swipe is easy.
    const handleDismiss = useCallback(() => {
        const { queue, currentIndex, position, queueSource, playQueue, seekTo, clearQueue } = useAudioStore.getState();
        haptic('tick');
        clearQueue();
        showSnackbar({
            text: 'Playback stopped',
            action: 'Undo',
            onAction: () => {
                playQueue(queue, currentIndex, queueSource ?? undefined).then(() => seekTo(position));
            },
        });
    }, []);

    const dragY = useSharedValue(0);
    useEffect(() => {
        if (hasTrack) dragY.value = 0;
    }, [hasTrack, dragY]);
    const dragStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: dragY.value }],
        opacity: 1 - Math.min(1, dragY.value / 80) * 0.6,
    }));

    const panGesture = useMemo(
        () =>
            Gesture.Pan()
                .activeOffsetX([-20, 20])
                .activeOffsetY([-20, 20])
                .onUpdate((e) => {
                    'worklet';
                    // Only a mostly-vertical downward drag moves the bar.
                    if (e.translationY > 0 && e.translationY > Math.abs(e.translationX)) {
                        dragY.value = e.translationY;
                    }
                })
                .onEnd((e) => {
                    'worklet';
                    const vertical = Math.abs(e.translationY) > Math.abs(e.translationX);
                    if (vertical && (e.translationY > 50 || e.velocityY > 800)) {
                        dragY.value = withTiming(120, { duration: motion.fadeOut }, (finished) => {
                            if (finished) runOnJS(handleDismiss)();
                        });
                        return;
                    }
                    dragY.value = withSpring(0, motion.spatial);
                    if (vertical && e.translationY < -35) {
                        runOnJS(handlePress)();
                    } else if (e.translationX < -45) {
                        runOnJS(handleSkipNext)();
                    } else if (e.translationX > 45) {
                        runOnJS(handleSkipPrev)();
                    }
                }),
        [dragY, handleDismiss, handlePress, handleSkipNext, handleSkipPrev]
    );

    if (!currentTrack) {
        return null;
    }

    return (
        <Animated.View style={dragStyle}>
            <View
                ref={barRef}
                collapsable={false}
                style={[styles.wrapper, { backgroundColor: cardColor, borderColor: colors.border, shadowColor: colors.shadow }]}
            >
                <GestureDetector gesture={panGesture}>
                    <Touchable
                        onPress={handlePress}
                        scaleTo={0.99}
                        style={styles.content}
                        accessibilityRole="button"
                        accessibilityLabel={`Now playing: ${currentTrack.title} by ${currentTrack.artist}`}
                    >
                        {/* Artwork */}
                        <View
                            ref={artRef}
                            onLayout={measureArt}
                            collapsable={false}
                            style={[styles.artContainer, { backgroundColor: colors.surfaceVariant }]}
                        >
                            {artworkUri ? (
                                <Image source={{ uri: artworkUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                            ) : (
                                <Feather name="music" size={18} color={colors.textTertiary} />
                            )}
                        </View>
    
                        {/* Track metadata */}
                        <View style={styles.textContainer}>
                            <Text style={[type.row, { color: colors.text }]} numberOfLines={1}>
                                {currentTrack.title}
                            </Text>
                            <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                                {currentTrack.artist}
                            </Text>
                        </View>
    
                        {/* Controls */}
                        <View style={styles.actions} pointerEvents="box-none">
                            {isBuffering ? (
                                <View style={styles.spinnerSlot}>
                                    <ActivityIndicator size="small" color={colors.primary} />
                                </View>
                            ) : (
                                <IconButton
                                    icon={isPlaying ? 'pause' : 'play'}
                                    onPress={togglePlayPause}
                                    accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                                    iconSize={20}
                                />
                            )}
                            <IconButton
                                icon="skip-forward"
                                onPress={handleSkipNext}
                                accessibilityLabel="Next track"
                                iconSize={20}
                            />
                        </View>
                    </Touchable>
                </GestureDetector>
    
                {/* Progress along the card's bottom edge */}
                <MiniPlayerProgressBar />
            </View>
        </Animated.View>
    );
}

const noop = () => {};

/**
 * The mini player's look without its behaviour: same styles, same layout, no gestures.
 * Now Playing draws it on its collapsing backdrop, so by the time the backdrop reaches the bar
 * it already shows the bar's title, artist and buttons. The cover slot is left empty because
 * Now Playing's own morphing cover lands there.
 */
export function MiniPlayerReplica() {
    const { colors, dark } = useTheme();
    const currentTrack = useAudioStore((s) => s.currentTrack);
    const isPlaying = useAudioStore((s) => s.isPlaying);
    const isBuffering = useAudioStore((s) => s.isBuffering);
    const palette = useAlbumPalette(currentTrack?.albumId, currentTrack?.uri);

    if (!currentTrack) {
        return null;
    }

    const cardColor = miniCardColor(dark, colors.cardElevated, palette.secondaryColor);

    return (
        <View
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
            style={[styles.wrapper, { backgroundColor: cardColor, borderColor: colors.border, shadowColor: colors.shadow }]}
        >
            <View style={styles.content}>
                <View style={styles.artContainer} />
                <View style={styles.textContainer}>
                    <Text style={[type.row, { color: colors.text }]} numberOfLines={1}>
                        {currentTrack.title}
                    </Text>
                    <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                        {currentTrack.artist}
                    </Text>
                </View>
                <View style={styles.actions}>
                    {isBuffering ? (
                        <View style={styles.spinnerSlot}>
                            <ActivityIndicator size="small" color={colors.primary} />
                        </View>
                    ) : (
                        <IconButton icon={isPlaying ? 'pause' : 'play'} onPress={noop} accessibilityLabel="" iconSize={20} />
                    )}
                    <IconButton icon="skip-forward" onPress={noop} accessibilityLabel="" iconSize={20} />
                </View>
            </View>
            <MiniPlayerProgressBar />
        </View>
    );
}

const styles = StyleSheet.create({
    // A floating card rather than a full-width strip: it reads as deliberate on any screen,
    // with or without a tab bar under it.
    wrapper: {
        marginHorizontal: metrics.space.sm,
        marginBottom: metrics.space.sm,
        borderRadius: MINI_CARD_RADIUS,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
        elevation: 6,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
    },
    progressTrack: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 2,
    },
    progressBar: {
        height: '100%',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 56,
        paddingHorizontal: metrics.space.sm,
        gap: metrics.space.md,
    },
    artContainer: {
        width: 40,
        height: 40,
        borderRadius: metrics.radius.sm,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    textContainer: {
        flex: 1,
        justifyContent: 'center',
        gap: 2,
    },
    // 48 dp IconButton boxes: no gap, and the last one reaches into the card padding,
    // so the glyphs stay about where the old 40 dp buttons had them.
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: -metrics.space.xs,
    },
    spinnerSlot: {
        width: metrics.touch,
        height: metrics.touch,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
