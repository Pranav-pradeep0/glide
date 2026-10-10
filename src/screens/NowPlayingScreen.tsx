import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
    ActivityIndicator,
    BackHandler,
    FlatList,
    type HostInstance,
    Image,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Feather from '@react-native-vector-icons/feather';
import { NowPlayingProgressBar } from '@/components/NowPlayingProgressBar';
import { NowPlayingLyrics } from '@/components/NowPlayingLyrics';
import LinearGradient from 'react-native-linear-gradient';
import Animated, {
    Extrapolation,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
    MINI_CARD_RADIUS,
    MiniPlayerReplica,
    miniArtRect,
    miniBarRect,
    miniCardColor,
    playerExpansion,
} from '@/components/MiniPlayer';
import { useAudioStore } from '@/store/audioStore';
import { useFavoritesStore } from '@/store/favoritesStore';
import { useTheme } from '@/hooks/useTheme';
import { useAlbumPalette } from '@/hooks/useAlbumArt';
import { LyricsService } from '@/services/LyricsService';
import { Chip, IconButton, ListGroup, ListRow, Sheet, Touchable } from '@/components/ui';
import { metrics, motion, type } from '@/theme/theme';
import { formatDuration } from '@/utils/formatUtils';
import { EQUALIZER_PRESETS } from '@/config/equalizerPresets';
import { AudioTrack, LyricLine } from '@/types';
import { haptic } from '@/native/HapticModule';

interface QueueItem {
    track: AudioTrack;
    index: number;
}

const SleepTimerContent = React.memo(({ onClose }: { onClose: () => void }) => {
    const sleepTimerMode = useAudioStore((s) => s.sleepTimerMode);
    const sleepTimerRemaining = useAudioStore((s) => s.sleepTimerRemaining);
    const setSleepTimer = useAudioStore((s) => s.setSleepTimer);

    return (
        <ListGroup inset style={styles.sleepTimerGroup}>
            <ListRow
                title="Off"
                selected={sleepTimerMode === 'off'}
                onPress={() => {
                    setSleepTimer('off');
                    onClose();
                }}
            />
            <ListRow
                title="15 minutes"
                selected={sleepTimerMode === 'time' && Math.round(sleepTimerRemaining / 60) === 15}
                value={sleepTimerMode === 'time' && Math.round(sleepTimerRemaining / 60) === 15 ? `${Math.ceil(sleepTimerRemaining / 60)}m left` : undefined}
                onPress={() => {
                    setSleepTimer(15);
                    onClose();
                }}
            />
            <ListRow
                title="30 minutes"
                selected={sleepTimerMode === 'time' && Math.round(sleepTimerRemaining / 60) === 30}
                value={sleepTimerMode === 'time' && Math.round(sleepTimerRemaining / 60) === 30 ? `${Math.ceil(sleepTimerRemaining / 60)}m left` : undefined}
                onPress={() => {
                    setSleepTimer(30);
                    onClose();
                }}
            />
            <ListRow
                title="45 minutes"
                selected={sleepTimerMode === 'time' && Math.round(sleepTimerRemaining / 60) === 45}
                value={sleepTimerMode === 'time' && Math.round(sleepTimerRemaining / 60) === 45 ? `${Math.ceil(sleepTimerRemaining / 60)}m left` : undefined}
                onPress={() => {
                    setSleepTimer(45);
                    onClose();
                }}
            />
            <ListRow
                title="60 minutes"
                selected={sleepTimerMode === 'time' && Math.round(sleepTimerRemaining / 60) === 60}
                value={sleepTimerMode === 'time' && Math.round(sleepTimerRemaining / 60) === 60 ? `${Math.ceil(sleepTimerRemaining / 60)}m left` : undefined}
                onPress={() => {
                    setSleepTimer(60);
                    onClose();
                }}
            />
            <ListRow
                title="At the end of this song"
                selected={sleepTimerMode === 'end_of_track'}
                onPress={() => {
                    setSleepTimer('end_of_track');
                    onClose();
                }}
            />
        </ListGroup>
    );
});

const SleepTimerSheet = React.memo(({ visible, onClose }: { visible: boolean; onClose: () => void }) => {
    return (
        <Sheet visible={visible} onClose={onClose} title="Sleep Timer">
            {visible ? <SleepTimerContent onClose={onClose} /> : null}
        </Sheet>
    );
});

export default function NowPlayingScreen() {
    const { colors, dark } = useTheme();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation();
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();

    const currentTrack = useAudioStore((s) => s.currentTrack);
    const queue = useAudioStore((s) => s.queue);
    const currentIndex = useAudioStore((s) => s.currentIndex);
    const isPlaying = useAudioStore((s) => s.isPlaying);
    const isBuffering = useAudioStore((s) => s.isBuffering);
    const shuffle = useAudioStore((s) => s.shuffle);
    const repeatMode = useAudioStore((s) => s.repeatMode);
    const equalizerPreset = useAudioStore((s) => s.equalizerPreset);
    const shuffledIndices = useAudioStore((s) => s.shuffledIndices);
    const queueSource = useAudioStore((s) => s.queueSource);
    const isSleepTimerActive = useAudioStore((s) => s.sleepTimerMode !== 'off');

    const togglePlayPause = useAudioStore((s) => s.togglePlayPause);
    const skipNext = useAudioStore((s) => s.skipNext);
    const skipPrevious = useAudioStore((s) => s.skipPrevious);
    const skipToIndex = useAudioStore((s) => s.skipToIndex);
    const toggleShuffle = useAudioStore((s) => s.toggleShuffle);
    const toggleRepeatMode = useAudioStore((s) => s.toggleRepeatMode);
    const setEqualizerPreset = useAudioStore((s) => s.setEqualizerPreset);
    const removeFromQueue = useAudioStore((s) => s.removeFromQueue);
    const moveQueueItem = useAudioStore((s) => s.moveQueueItem);

    // Favorites
    const isFavorite = useFavoritesStore((s) => (currentTrack ? s.isFavorite(currentTrack.id) : false));
    const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);

    // Lazily resolve artwork and dynamic palette colors
    const { artworkUri: fetchedArt, primaryColor, secondaryColor, onPrimaryColor } = useAlbumPalette(
        currentTrack?.albumId,
        currentTrack?.uri
    );
    const artworkUri = currentTrack?.artworkUri || fetchedArt;
    const accentColor = primaryColor || colors.primary;

    // View toggles and sheets
    const [showQueue, setShowQueue] = useState(false);
    const [showEqualizer, setShowEqualizer] = useState(false);
    const [showSleepTimer, setShowSleepTimer] = useState(false);
    const [showLyrics, setShowLyrics] = useState(false);

    // Lyrics state
    const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
    const [isLyricsLoading, setIsLyricsLoading] = useState(false);
    const currentTrackId = currentTrack?.id;

    // Load lyrics when currentTrack id changes
    useEffect(() => {
        if (!currentTrack) {
            setLyrics(null);
            setIsLyricsLoading(false);
            return;
        }
        let isMounted = true;
        setLyrics(null);
        setIsLyricsLoading(true);
        LyricsService.getLyricsForTrack(currentTrack).then((data) => {
            if (isMounted) {
                setLyrics(data);
                setIsLyricsLoading(false);
            }
        });
        return () => {
            isMounted = false;
        };
    }, [currentTrackId]); // eslint-disable-line react-hooks/exhaustive-deps

    const handlePickLyrics = useCallback(async () => {
        if (!currentTrack) return;
        const loaded = await LyricsService.pickAndSaveLyrics(currentTrack.id);
        if (loaded) {
            setLyrics(loaded);
        }
    }, [currentTrack]);

    const handleSelectPreset = useCallback(
        (presetId: string) => {
            setEqualizerPreset(presetId);
        },
        [setEqualizerPreset]
    );

    const handleToggleFavorite = useCallback(() => {
        if (!currentTrack) return;
        haptic('tick');
        toggleFavorite(currentTrack.id);
    }, [currentTrack, toggleFavorite]);

    // ----- Expand / collapse -----
    // One value drives the whole transition: 0 is the mini player, 1 is this screen. The
    // cover morphs between the mini player's cover rect and the big cover's rect, while the
    // backdrop and controls slide and fade with it. Dragging down scrubs the same value.

    // Captured once: the mini player this screen opened from, and so collapses back onto.
    const [mini] = useState(() =>
        miniArtRect.width > 0
            ? { ...miniArtRect }
            : // Not measured yet (first song started from a list): roughly above the tab bar.
              { x: metrics.gutter, y: windowHeight - insets.bottom - 112, width: 40, height: 40 }
    );
    const [miniBar] = useState(() =>
        miniBarRect.height > 0
            ? { ...miniBarRect }
            : {
                  x: metrics.space.sm,
                  y: mini.y - metrics.space.sm,
                  width: windowWidth - metrics.space.sm * 2,
                  height: 56,
              }
    );
    // How far the sheet travels: its top edge meets the mini player's top at progress 0.
    const travel = Math.max(1, miniBar.y);
    // Where the player's bottom edge sits when collapsed: the bottom of the mini player bar,
    // which on the tab screens is the top of the tab bar.
    const barBottom = miniBar.y + miniBar.height;

    // Shared with the tab bar, which slides in step with this screen's bottom edge.
    const progress = playerExpansion;
    useEffect(() => {
        progress.value = 0;
        return () => {
            progress.value = 0;
        };
    }, [progress]);
    const measured = useSharedValue(0);
    const bigX = useSharedValue(0);
    const bigY = useSharedValue(0);
    const lyricsShown = useSharedValue(0);
    const opened = useRef(false);
    const closing = useRef(false);
    const artPlaceholderRef = useRef<HostInstance>(null);

    useEffect(() => {
        lyricsShown.value = showLyrics ? 1 : 0;
    }, [showLyrics, lyricsShown]);

    // The big cover's position is only known after layout. The first measurement starts the
    // open animation, so the cover never flies toward a stale target.
    const handleArtLayout = useCallback(() => {
        artPlaceholderRef.current?.measureInWindow((x, y) => {
            bigX.value = x;
            bigY.value = y;
            if (!opened.current) {
                opened.current = true;
                measured.value = 1;
                progress.value = withSpring(1, { ...motion.spatial, overshootClamping: true });
            }
        });
    }, [bigX, bigY, measured, progress]);

    const finishCollapse = useCallback(() => {
        if (navigation.canGoBack()) navigation.goBack();
    }, [navigation]);

    const handleDismiss = useCallback(() => {
        if (closing.current) return;
        closing.current = true;
        progress.value = withSpring(0, { ...motion.spatial, overshootClamping: true }, (finished) => {
            if (finished) runOnJS(finishCollapse)();
        });
    }, [progress, finishCollapse]);

    // Hardware and predictive back collapse onto the mini player instead of cutting away.
    useFocusEffect(
        useCallback(() => {
            const sub = BackHandler.addEventListener('hardwareBackPress', () => {
                handleDismiss();
                return true;
            });
            return () => sub.remove();
        }, [handleDismiss])
    );

    const handleSkipNext = useCallback(() => {
        haptic('tick');
        skipNext();
    }, [skipNext]);

    const handleSkipPrevious = useCallback(() => {
        haptic('tick');
        skipPrevious();
    }, [skipPrevious]);

    // Cover horizontal swipe to skip. Fails on vertical movement so a downward drag that
    // starts on the cover still collapses the player.
    const coverTranslateX = useSharedValue(0);
    const coverPanGesture = useMemo(
        () =>
            Gesture.Pan()
                .activeOffsetX([-20, 20])
                .failOffsetY([-20, 20])
                .onUpdate((e) => {
                    'worklet';
                    coverTranslateX.value = e.translationX * 0.35;
                })
                .onEnd((e) => {
                    'worklet';
                    if (e.translationX < -50 || e.velocityX < -400) {
                        runOnJS(handleSkipNext)();
                    } else if (e.translationX > 50 || e.velocityX > 400) {
                        runOnJS(handleSkipPrevious)();
                    }
                    coverTranslateX.value = withSpring(0, motion.spatial);
                }),
        [coverTranslateX, handleSkipNext, handleSkipPrevious]
    );

    // Swipe down: the player follows the finger, then either collapses onto the mini player
    // or springs back open. Downward only; gives up on horizontal movement.
    const dismissPanGesture = useMemo(
        () =>
            Gesture.Pan()
                .activeOffsetY(20)
                .failOffsetX([-20, 20])
                .onUpdate((e) => {
                    'worklet';
                    progress.value = Math.min(1, Math.max(0, 1 - e.translationY / travel));
                })
                .onEnd((e) => {
                    'worklet';
                    if (e.translationY > travel * 0.2 || e.velocityY > 800) {
                        progress.value = withSpring(
                            0,
                            { ...motion.spatial, overshootClamping: true, velocity: -e.velocityY / travel },
                            (finished) => {
                                if (finished) runOnJS(finishCollapse)();
                            }
                        );
                    } else {
                        progress.value = withSpring(1, { ...motion.spatial, overshootClamping: true });
                    }
                }),
        [progress, travel, finishCollapse]
    );

    // Responsive artwork sizing
    const artSize = useMemo(() => {
        const availableWidth = windowWidth - metrics.gutter * 2;
        const maxArtHeight = windowHeight * 0.38;
        return Math.min(availableWidth, maxArtHeight, 330);
    }, [windowWidth, windowHeight]);

    // Everything is clipped above a bottom edge that moves from the screen bottom (open) to the
    // bottom of the mini player bar (closed). The tab bar slides up in step with that edge, so
    // the tabs come back as one piece instead of being covered and then uncovered.
    const clipStyle = useAnimatedStyle(() => ({
        height: barBottom + (windowHeight - barBottom) * progress.value,
    }));

    // The backdrop is the mini player card grown to full screen. Closing, its edges move in to
    // the card's rect and its corners round to the card's radius; it turns the card's colour on
    // the way and only fades in the last few percent, revealing the real card in the same place.
    const backdropStyle = useAnimatedStyle(() => {
        const p = progress.value;
        const q = 1 - p;
        const top = q * travel;
        const bottom = barBottom + (windowHeight - barBottom) * p;
        return {
            opacity: interpolate(p, [0, 0.08], [0, 1], Extrapolation.CLAMP),
            left: miniBar.x * q,
            width: windowWidth - (windowWidth - miniBar.width) * q,
            height: bottom - top,
            borderRadius: MINI_CARD_RADIUS * q,
            transform: [{ translateY: top }],
        };
    });
    // The mini player's title, artist and buttons ride on the top of the backdrop and fade in
    // as it closes, so the player turns into the bar rather than only its cover moving.
    const miniRowStyle = useAnimatedStyle(() => ({
        opacity: interpolate(progress.value, [0, 0.3], [1, 0], Extrapolation.CLAMP),
        transform: [{ translateY: (1 - progress.value) * travel }],
    }));
    const barTintStyle = useAnimatedStyle(() => ({
        opacity: interpolate(progress.value, [0, 0.6], [1, 0], Extrapolation.CLAMP),
    }));

    // Controls ride with the backdrop and fade in over the last half. Held in place until the
    // cover is measured, because measureInWindow would otherwise include this translation.
    const contentStyle = useAnimatedStyle(() => ({
        opacity: interpolate(progress.value, [0.45, 1], [0, 1], Extrapolation.CLAMP),
        transform: [{ translateY: measured.value ? (1 - progress.value) * travel : 0 }],
    }));

    // The cover is one view morphing between the two rects. Transforms only, so it runs on
    // the UI thread without relayout.
    const coverStyle = useAnimatedStyle(() => {
        const p = progress.value;
        const scale = interpolate(p, [0, 1], [mini.width / artSize, 1]);
        const inset = (artSize * (1 - scale)) / 2;
        const x = mini.x + (bigX.value - mini.x) * p;
        const y = mini.y + (bigY.value - mini.y) * p;
        // Visible radius is radius * scale; keep it matching each end's corner.
        const radius = interpolate(p, [0, 1], [metrics.radius.sm, metrics.radius.card]) / scale;
        return {
            borderRadius: radius,
            opacity: 1 - lyricsShown.value * interpolate(p, [0.6, 1], [0, 1], Extrapolation.CLAMP),
            transform: [
                { translateX: x - inset + coverTranslateX.value },
                { translateY: y - inset },
                { scale },
            ],
        };
    });

    // Ordered queue items (reflects shuffle sequence if active)
    const displayQueue: QueueItem[] = useMemo(() => {
        if (shuffle && shuffledIndices.length === queue.length) {
            return shuffledIndices.map((idx) => ({ track: queue[idx], index: idx }));
        }
        return queue.map((track, index) => ({ track, index }));
    }, [queue, shuffle, shuffledIndices]);

    // Compute initial scroll index for the current playing song
    const currentQueueDisplayIndex = useMemo(() => {
        const idx = displayQueue.findIndex((item) => item.index === currentIndex);
        return idx >= 0 ? idx : 0;
    }, [displayQueue, currentIndex]);

    if (!currentTrack) {
        return (
            <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
                <View style={styles.header}>
                    <IconButton
                        icon="chevron-down"
                        onPress={() => navigation.goBack()}
                        accessibilityLabel="Close player"
                    />
                </View>
                <View style={styles.emptyContainer}>
                    <Feather name="music" size={48} color={colors.textTertiary} />
                    <Text style={[type.row, { color: colors.textSecondary }]}>No track loaded</Text>
                </View>
            </View>
        );
    }

    return (
        <GestureDetector gesture={dismissPanGesture}>
            <Animated.View style={[styles.clip, clipStyle]}>
                {/* Backdrop: gradient tinted by the cover's primary color, shaped into the mini
                    player card as the player closes. */}
                <Animated.View
                    pointerEvents="none"
                    style={[styles.backdrop, { backgroundColor: colors.background }, backdropStyle]}
                >
                    <LinearGradient
                        colors={
                            primaryColor
                                ? [
                                      primaryColor,
                                      secondaryColor || `${primaryColor}66`,
                                      dark ? '#121214' : colors.background,
                                  ]
                                : [dark ? '#1c1c1f' : '#e6e6ea', colors.background]
                        }
                        style={StyleSheet.absoluteFill}
                        start={{ x: 0.5, y: 0 }}
                        end={{ x: 0.5, y: 0.9 }}
                    />
                    <View
                        style={[
                            StyleSheet.absoluteFill,
                            {
                                backgroundColor: dark ? 'rgba(0,0,0,0.48)' : 'rgba(255,255,255,0.45)',
                            },
                        ]}
                    />
                    {/* The mini player card's colour, showing as the backdrop becomes the card */}
                    <Animated.View
                        style={[
                            StyleSheet.absoluteFill,
                            { backgroundColor: miniCardColor(dark, colors.cardElevated, secondaryColor) },
                            barTintStyle,
                        ]}
                    />
                </Animated.View>

                {/* Fixed full height too: its flex layout must not follow the moving clip. */}
                <Animated.View style={[styles.layer, { height: windowHeight }, contentStyle]}>
                    {/* Header */}
                    <View style={[styles.header, { paddingTop: insets.top + metrics.space.xs }]}>
                        <IconButton
                            icon="chevron-down"
                            onPress={handleDismiss}
                            accessibilityLabel="Collapse player"
                            iconSize={26}
                        />
                        <View style={styles.headerTitleWrap}>
                            <Text
                                style={[
                                    type.caption,
                                    { color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 1.2 },
                                ]}
                                numberOfLines={1}
                            >
                                {queueSource ? `Playing from ${queueSource}` : 'Playing from Library'}
                            </Text>
                            <Text style={[type.row, { color: colors.text }]} numberOfLines={1}>
                                {currentTrack.album || currentTrack.artist || 'Glide Audio'}
                            </Text>
                        </View>
                        <View style={styles.headerActions}>
                            <IconButton
                                icon="moon"
                                onPress={() => setShowSleepTimer(true)}
                                active={isSleepTimerActive}
                                accessibilityLabel="Sleep timer"
                                iconSize={20}
                            />
                            <IconButton
                                icon="sliders"
                                onPress={() => setShowEqualizer(true)}
                                accessibilityLabel="Equalizer"
                                iconSize={20}
                            />
                        </View>
                    </View>

                    {/* Main Content Body */}
                    <View style={styles.body}>
                        {/* Artwork / Lyrics Interactive Area */}
                        <View style={styles.artArea}>
                            {showLyrics ? (
                                <NowPlayingLyrics
                                    lyrics={lyrics}
                                    artSize={artSize}
                                    accentColor={accentColor}
                                    isLoading={isLyricsLoading}
                                    onPickLyrics={handlePickLyrics}
                                />
                            ) : (
                                // Holds the cover's place in the layout; the cover itself is the
                                // morphing layer below, drawn over this rect.
                                <View
                                    ref={artPlaceholderRef}
                                    onLayout={handleArtLayout}
                                    collapsable={false}
                                    style={{ width: artSize, height: artSize }}
                                />
                            )}
                        </View>

                        {/* Track Info (Title on 2 lines with Favorite action) */}
                        <View style={styles.infoArea}>
                            <View style={styles.titleRow}>
                                <View style={styles.titleTextWrap}>
                                    <Text
                                        style={[type.heading, { color: colors.text, textAlign: 'center' }]}
                                        numberOfLines={2}
                                    >
                                        {currentTrack.title}
                                    </Text>
                                    <Text
                                        style={[type.body, { color: colors.textSecondary, textAlign: 'center' }]}
                                        numberOfLines={1}
                                    >
                                        {currentTrack.artist}
                                    </Text>
                                </View>
                            </View>
                        </View>

                        {/* Scrubber / Slider Tinted with cover's accent */}
                        <NowPlayingProgressBar
                            accentColor={accentColor}
                            trackDuration={currentTrack.duration}
                        />

                        {/* Controls Row */}
                        <View style={styles.controlsArea}>
                            {/* Shuffle button */}
                            <IconButton
                                icon="shuffle"
                                onPress={toggleShuffle}
                                active={shuffle}
                                accessibilityLabel="Shuffle"
                                iconSize={20}
                            />

                            {/* Previous */}
                            <IconButton
                                icon="skip-back"
                                onPress={handleSkipPrevious}
                                accessibilityLabel="Previous track"
                                iconSize={26}
                            />

                            {/* Play/Pause FAB with real spinner when buffering */}
                            <Touchable
                                onPress={togglePlayPause}
                                style={[styles.playFab, { backgroundColor: accentColor }]}
                                accessibilityRole="button"
                                accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                                scaleTo={0.94}
                            >
                                {isBuffering ? (
                                    <ActivityIndicator size="small" color={onPrimaryColor || colors.onPrimary} />
                                ) : (
                                    <Feather
                                        name={isPlaying ? 'pause' : 'play'}
                                        size={28}
                                        color={onPrimaryColor || colors.onPrimary}
                                        style={!isPlaying ? { marginLeft: 3 } : undefined}
                                    />
                                )}
                            </Touchable>

                            {/* Next */}
                            <IconButton
                                icon="skip-forward"
                                onPress={handleSkipNext}
                                accessibilityLabel="Next track"
                                iconSize={26}
                            />

                            {/* Repeat button */}
                            <View>
                                <IconButton
                                    icon="repeat"
                                    onPress={toggleRepeatMode}
                                    active={repeatMode !== 'off'}
                                    accessibilityLabel={`Repeat mode: ${repeatMode}`}
                                    iconSize={20}
                                />
                                {repeatMode === 'one' && (
                                    <View style={[styles.repeatBadge, { backgroundColor: accentColor, borderColor: colors.background }]}>
                                        <Text style={[styles.repeatBadgeText, { color: onPrimaryColor || colors.onPrimary }]}>1</Text>
                                    </View>
                                )}
                            </View>
                        </View>

                        {/* Bottom Row: Actions & Queue Trigger */}
                        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, metrics.space.sm) }]}>
                            <IconButton
                                icon="heart"
                                onPress={handleToggleFavorite}
                                active={isFavorite}
                                color={isFavorite ? colors.primary : colors.textSecondary}
                                accessibilityLabel="Toggle favorite"
                                iconSize={20}
                            />

                            <Touchable
                                onPress={() => setShowQueue(true)}
                                style={[styles.queueButton, { backgroundColor: colors.fill }]}
                                accessibilityLabel="View queue"
                                scaleTo={0.98}
                            >
                                <Feather name="list" size={18} color={colors.textSecondary} />
                                <Text style={[type.label, { color: colors.textSecondary }]}>
                                    Queue ({queue.length})
                                </Text>
                            </Touchable>

                            <IconButton
                                icon="file-text"
                                onPress={() => setShowLyrics(!showLyrics)}
                                active={showLyrics}
                                accessibilityLabel="Toggle lyrics"
                                iconSize={20}
                            />
                        </View>
                    </View>

                    {/* Queue Bottom Sheet (Opens at current song, supports remove and reorder) */}
                    <Sheet
                        visible={showQueue}
                        onClose={() => setShowQueue(false)}
                        title={`Queue (${queue.length})`}
                    >
                        <View style={styles.sheetListWrap}>
                            <FlatList
                                data={displayQueue}
                                keyExtractor={(item) => `${item.track.id}-${item.index}`}
                                initialScrollIndex={currentQueueDisplayIndex}
                                getItemLayout={(_, index) => ({
                                    length: 58,
                                    offset: 58 * index,
                                    index,
                                })}
                                onScrollToIndexFailed={() => {
                                    // Gracefully ignore layout calculation failure
                                }}
                                renderItem={({ item, index: displayIndex }) => {
                                    const isCurrent = item.index === currentIndex;
                                    return (
                                        <View style={[styles.queueRowWrap, isCurrent && { backgroundColor: colors.primaryContainer }]}>
                                            <Touchable
                                                style={styles.queueRowTouchable}
                                                onPress={() => {
                                                    skipToIndex(item.index);
                                                    setShowQueue(false);
                                                }}
                                                scaleTo={0.98}
                                            >
                                                <Feather
                                                    name={isCurrent ? 'volume-2' : 'music'}
                                                    size={18}
                                                    color={isCurrent ? accentColor : colors.textTertiary}
                                                />
                                                <View style={styles.queueItemInfo}>
                                                    <Text
                                                        style={[
                                                            type.row,
                                                            { color: isCurrent ? accentColor : colors.text, fontWeight: isCurrent ? '700' : '400' },
                                                        ]}
                                                        numberOfLines={1}
                                                    >
                                                        {item.track.title}
                                                    </Text>
                                                    <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                                                        {item.track.artist} · {formatDuration(item.track.duration)}
                                                    </Text>
                                                </View>
                                            </Touchable>

                                            {/* Queue item actions: reorder & remove */}
                                            <View style={styles.queueItemActions}>
                                                {!shuffle && displayIndex > 0 && (
                                                    <IconButton
                                                        icon="chevron-up"
                                                        onPress={() => moveQueueItem(item.index, item.index - 1)}
                                                        accessibilityLabel="Move up"
                                                        iconSize={16}
                                                        style={styles.smallQueueBtn}
                                                    />
                                                )}
                                                {!shuffle && displayIndex < displayQueue.length - 1 && (
                                                    <IconButton
                                                        icon="chevron-down"
                                                        onPress={() => moveQueueItem(item.index, item.index + 1)}
                                                        accessibilityLabel="Move down"
                                                        iconSize={16}
                                                        style={styles.smallQueueBtn}
                                                    />
                                                )}
                                                <IconButton
                                                    icon="x"
                                                    onPress={() => removeFromQueue(item.index)}
                                                    accessibilityLabel="Remove from queue"
                                                    iconSize={16}
                                                    style={styles.smallQueueBtn}
                                                />
                                            </View>
                                        </View>
                                    );
                                }}
                                initialNumToRender={15}
                                maxToRenderPerBatch={10}
                                windowSize={5}
                                showsVerticalScrollIndicator={false}
                            />
                        </View>
                    </Sheet>

                    {/* Sleep Timer Bottom Sheet */}
                    <SleepTimerSheet
                        visible={showSleepTimer}
                        onClose={() => setShowSleepTimer(false)}
                    />

                    {/* Equalizer Bottom Sheet */}
                    <Sheet visible={showEqualizer} onClose={() => setShowEqualizer(false)} title="Equalizer Presets">
                        <View style={styles.presetsWrap}>
                            {EQUALIZER_PRESETS.map((p) => {
                                const selected = equalizerPreset === p.id;
                                return (
                                    <Chip
                                        key={p.id}
                                        label={p.name}
                                        selected={selected}
                                        onPress={() => handleSelectPreset(p.id)}
                                    />
                                );
                            })}
                        </View>
                    </Sheet>
                </Animated.View>

                <Animated.View pointerEvents="none" style={[styles.miniRow, miniRowStyle]}>
                    <MiniPlayerReplica />
                </Animated.View>

                {/* The cover: grows out of the mini player's cover and shrinks back into it */}
                <GestureDetector gesture={coverPanGesture}>
                    <Animated.View
                        pointerEvents={showLyrics ? 'none' : 'auto'}
                        style={[
                            styles.artFrame,
                            {
                                width: artSize,
                                height: artSize,
                                backgroundColor: colors.surfaceVariant,
                                shadowColor: colors.shadow,
                            },
                            coverStyle,
                        ]}
                    >
                        {artworkUri ? (
                            <Image source={{ uri: artworkUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                        ) : (
                            <View style={styles.artPlaceholder}>
                                <Feather name="music" size={artSize * 0.3} color={colors.textTertiary} />
                            </View>
                        )}
                    </Animated.View>
                </GestureDetector>
            </Animated.View>
        </GestureDetector>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    clip: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        overflow: 'hidden',
    },
    layer: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
    },
    // Left, width, height and corners are animated (backdropStyle).
    backdrop: {
        position: 'absolute',
        top: 0,
        overflow: 'hidden',
    },
    miniRow: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: metrics.gutter,
        minHeight: 56,
    },
    headerTitleWrap: {
        flex: 1,
        alignItems: 'center',
        paddingHorizontal: metrics.space.sm,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: metrics.space.md,
    },
    body: {
        flex: 1,
        justifyContent: 'space-between',
        paddingHorizontal: metrics.gutter,
    },
    artArea: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: metrics.space.sm,
    },
    artFrame: {
        position: 'absolute',
        left: 0,
        top: 0,
        overflow: 'hidden',
        elevation: 8,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 14,
    },
    artPlaceholder: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    lyricsBox: {
        width: '100%',
        borderRadius: metrics.radius.card,
        overflow: 'hidden',
        padding: metrics.space.md,
    },
    lyricsContent: {
        paddingVertical: metrics.space.lg,
    },
    lyricRow: {
        paddingVertical: metrics.space.sm,
        paddingHorizontal: metrics.space.sm,
        borderRadius: metrics.radius.sm,
    },
    lyricText: {
        textAlign: 'center',
        lineHeight: 26,
    },
    emptyLyricsWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: metrics.space.md,
        paddingHorizontal: metrics.space.lg,
    },
    infoArea: {
        paddingVertical: metrics.space.xs,
    },
    titleRow: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    titleTextWrap: {
        width: '100%',
        alignItems: 'center',
        gap: 4,
    },
    scrubberArea: {
        paddingVertical: metrics.space.xs,
    },
    slider: {
        width: '100%',
        height: 40,
    },
    timeRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: metrics.space.xs,
        marginTop: -6,
    },
    timeText: {
        fontVariant: ['tabular-nums'],
    },
    controlsArea: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: metrics.space.sm,
        paddingHorizontal: metrics.space.xs,
    },
    playFab: {
        width: 68,
        height: 68,
        borderRadius: 34,
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 4,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
    },
    repeatBadge: {
        position: 'absolute',
        top: 0,
        right: 0,
        width: 16,
        height: 16,
        borderRadius: 8,
        // Ringed so it stays legible on the solid "on" circle when the accent is the same colour.
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    repeatBadgeText: {
        fontSize: 9,
        fontWeight: '700',
    },
    bottomBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: metrics.space.xs,
    },
    queueButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: metrics.space.lg,
        paddingVertical: metrics.space.sm,
        borderRadius: metrics.radius.pill,
        gap: metrics.space.xs,
    },
    sheetListWrap: {
        maxHeight: 420,
    },
    queueRowWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: metrics.gutter,
        height: 58,
        borderRadius: metrics.radius.md,
    },
    queueRowTouchable: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.md,
    },
    queueItemInfo: {
        flex: 1,
        gap: 2,
    },
    queueItemActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    smallQueueBtn: {
        width: 32,
        height: 32,
    },
    sleepTimerGroup: {
        paddingHorizontal: metrics.gutter,
        paddingVertical: metrics.space.sm,
    },
    presetsWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: metrics.space.sm,
        paddingHorizontal: metrics.gutter,
        paddingVertical: metrics.space.md,
    },
});
