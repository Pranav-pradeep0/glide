import React, { FC, useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import { EdgeInsets } from 'react-native-safe-area-context';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    SharedValue,
    runOnJS,
    useDerivedValue,
    useAnimatedReaction,
    withTiming,
    withSpring,
    withRepeat,
    withSequence,
    Easing,
    cancelAnimation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
    PipIcon, AudioIcon, SubtitleIcon, BookmarkListIcon, VisualEnhancementIcon, OrientationLockIcon, NightModeIcon, SkipRingIcon, getResizeModeIcon, getResizeModeLabel, formatRate,
} from './PlayerIcons';
import { Button, Gradient, IconButton, Touchable } from '@/components/ui';
import { haptic } from '@/native/HapticModule';
import { metrics, motion, playerTheme, type } from '@/theme/theme';
import { HUD_PILL } from '@/theme/colors';

const { colors } = playerTheme;

const TOP_SCRIM = ['rgba(0,0,0,0.62)', 'rgba(0,0,0,0)'];
const BOTTOM_SCRIM = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)'];
const BUBBLE_WIDTH = 96;

/** "1:02:03" / "02:03"; -1 is the "no duration yet" sentinel. */
const formatClock = (val: number) => {
    'worklet';
    if (val < 0) {return '--:--';}
    const seconds = Math.floor(val);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    const ss = s < 10 ? `0${s}` : `${s}`;
    const h = Math.floor(m / 60);
    if (h > 0) {
        const mm = m % 60;
        return `${h}:${mm < 10 ? `0${mm}` : mm}:${ss}`;
    }
    return `${m < 10 ? `0${m}` : m}:${ss}`;
};

/** "+7:27" / "-0:45". */
const formatDelta = (val: number) => {
    'worklet';
    const abs = Math.round(Math.abs(val));
    const s = abs % 60;
    return `${val < 0 ? '-' : '+'}${Math.floor(abs / 60)}:${s < 10 ? `0${s}` : s}`;
};

// ============================================================================
// REANIMATED TEXT
// ============================================================================

interface ReanimatedTextProps {
    value: SharedValue<number>;
    formatter: (val: number) => string;
    style?: any;
    fallbackText?: string;
}

const ReanimatedText: React.FC<ReanimatedTextProps> = ({ value, formatter, style, fallbackText }) => {
    const [text, setText] = useState(fallbackText ?? '');
    const updateText = useCallback((next: string) => setText(prev => prev === next ? prev : next), []);

    useEffect(() => {
        if (fallbackText !== undefined) {updateText(fallbackText);}
    }, [fallbackText, updateText]);

    useAnimatedReaction(
        () => formatter(value.value),
        (next, prev) => {
            if (next !== prev) {runOnJS(updateText)(next);}
        });

    return <Text style={[styles.time, style]}>{text}</Text>;
};

// ============================================================================
// SEEK BAR
// ============================================================================

interface SeekBarProps {
    currentTime: SharedValue<number>;
    duration: SharedValue<number>;
    isScrubbing: SharedValue<boolean>;
    seekPreviewTime: SharedValue<number>;
    /** 0 → 1 while the user drags this bar or swipe-seeks on the video. */
    grow: SharedValue<number>;
    dragging: SharedValue<boolean>;
    swipeSeeking: SharedValue<boolean>;
    swipeSeekStart: SharedValue<number>;
    /** TalkBack: expose the bar as an adjustable with a spoken position. */
    screenReader: boolean;
    onStepBackward: () => void;
    onStepForward: () => void;
    bookmarks: number[];
    durationSeconds: number;
    buffering: boolean;
    onSeekStart: () => void;
    onSeek: (val: number) => void;
    onSeekComplete: (val: number) => void;
}

const SeekBar: React.FC<SeekBarProps> = ({
    currentTime, duration, isScrubbing, seekPreviewTime, grow, dragging, swipeSeeking, swipeSeekStart,
    screenReader, onStepBackward, onStepForward,
    bookmarks, durationSeconds, buffering, onSeekStart, onSeek, onSeekComplete,
}) => {
    const trackWidth = useSharedValue(0);
    const scrubStart = useSharedValue(0);
    const lastSeekDispatchAt = useSharedValue(0);
    const loading = useSharedValue(0);

    useEffect(() => {
        if (!buffering) {
            cancelAnimation(loading);
            loading.value = 0;
            return;
        }
        // ponytail: indeterminate loop needs a period; linear 1 s, not a motion token.
        loading.value = withRepeat(withTiming(1, { duration: 1000, easing: Easing.linear }), -1);
    }, [buffering, loading]);

    const progress = useDerivedValue(() => {
        const d = duration.value;
        if (d <= 0) {return 0;}
        const time = isScrubbing.value ? seekPreviewTime.value : currentTime.value;
        return Math.max(0, Math.min(1, time / d));
    });

    const trackStyle = useAnimatedStyle(() => {
        const h = 4 + 4 * grow.value;
        return { height: h, borderRadius: h / 2 };
    });
    // Scaled, not shifted by the measured width: trackWidth only updates in onLayout, a
    // frame after a rotation resizes the bar, and a shift by the old width showed the
    // difference as a white block.
    const fillStyle = useAnimatedStyle(() => ({
        transform: [{ scaleX: progress.value }],
    }));
    const thumbStyle = useAnimatedStyle(() => {
        const size = 14 + 6 * grow.value;
        return {
            width: size,
            height: size,
            borderRadius: size / 2,
            left: `${progress.value * 100}%`,
            transform: [{ translateX: -size / 2 }],
        };
    });
    const bubbleStyle = useAnimatedStyle(() => {
        const half = BUBBLE_WIDTH / 2;
        let offset = -half;
        if (trackWidth.value > 0) {
            const x = progress.value * trackWidth.value;
            if (x < half) {
                offset = -x;
            } else if (x > trackWidth.value - half) {
                offset = -(half + (x - (trackWidth.value - half)));
            }
        }
        return {
            opacity: grow.value,
            left: `${progress.value * 100}%`,
            transform: [{ translateX: offset }],
        };
    });
    const loadingStyle = useAnimatedStyle(() => ({
        opacity: buffering ? 1 : 0,
        left: `${(loading.value * 1.3 - 0.3) * 100}%`,
    }));
    const readinessStyle = useAnimatedStyle(() => ({
        // Dimmed, not hidden, until a duration exists: the bar can't seek yet.
        opacity: withTiming(duration.value > 0 ? 1 : 0.35, { duration: motion.fadeIn }),
    }));

    const delta = useDerivedValue(() => seekPreviewTime.value - scrubStart.value);

    // A swipe on the video scrubs through this same bar; take its origin for the delta.
    useAnimatedReaction(
        () => swipeSeeking.value,
        (on, was) => {
            if (on && !was) {scrubStart.value = swipeSeekStart.value;}
        });

    // "12:04 of 45:00", only computed while a screen reader is on (re-renders every second).
    const [a11yValue, setA11yValue] = useState('');
    useAnimatedReaction(
        () => (screenReader && duration.value > 0
            ? `${formatClock(isScrubbing.value ? seekPreviewTime.value : currentTime.value)} of ${formatClock(duration.value)}`
            : ''),
        (next, prev) => {
            if (next !== prev) {runOnJS(setA11yValue)(next);}
        }, [screenReader]);

    const toTime = (x: number) => {
        'worklet';
        return Math.max(0, Math.min(1, x / trackWidth.value)) * duration.value;
    };

    const crossesBookmark = (from: number, to: number) => {
        'worklet';
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        for (let i = 0; i < bookmarks.length; i++) {
            if (bookmarks[i] > lo && bookmarks[i] <= hi) {return true;}
        }
        return false;
    };

    const pan = Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => {
            'worklet';
            if (trackWidth.value <= 0 || duration.value <= 0) {return;}
            dragging.value = true;
            isScrubbing.value = true;
            scrubStart.value = currentTime.value;
            seekPreviewTime.value = toTime(e.x);
            lastSeekDispatchAt.value = Date.now();
            runOnJS(onSeekStart)();
            runOnJS(onSeek)(seekPreviewTime.value);
        })
        .onUpdate((e) => {
            'worklet';
            if (!dragging.value) {return;}
            const prev = seekPreviewTime.value;
            const next = toTime(e.x);
            seekPreviewTime.value = next;
            if (crossesBookmark(prev, next)) {runOnJS(haptic)('segmentTick');}
            const now = Date.now();
            if (now - lastSeekDispatchAt.value >= 33) {
                lastSeekDispatchAt.value = now;
                runOnJS(onSeek)(next);
            }
        })
        .onFinalize(() => {
            'worklet';
            if (!dragging.value) {return;}
            dragging.value = false;
            // isScrubbing stays true until the seek lands, so the bar does not snap back.
            runOnJS(onSeekComplete)(seekPreviewTime.value);
        });

    return (
        <GestureDetector gesture={pan}>
            <Animated.View
                style={[styles.seekBar, readinessStyle]}
                onLayout={(e) => { trackWidth.value = e.nativeEvent.layout.width; }}
                hitSlop={{ top: 16, bottom: 16 }}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel="Seek"
                accessibilityValue={{ text: a11yValue }}
                accessibilityActions={SEEK_ACTIONS}
                onAccessibilityAction={(e) => {
                    if (e.nativeEvent.actionName === 'increment') {onStepForward();}
                    if (e.nativeEvent.actionName === 'decrement') {onStepBackward();}
                }}
            >
                <Animated.View style={[styles.bubble, bubbleStyle]} pointerEvents="none">
                    <ReanimatedText value={seekPreviewTime} formatter={formatClock} style={styles.bubbleTime} />
                    <ReanimatedText value={delta} formatter={formatDelta} style={styles.bubbleDelta} />
                </Animated.View>
                <Animated.View style={[styles.track, trackStyle]}>
                    <Animated.View style={[styles.fill, fillStyle]} />
                    {buffering && <Animated.View style={[styles.loading, loadingStyle]} />}
                </Animated.View>
                {durationSeconds > 0 && bookmarks.map(t => (
                    <View
                        key={t}
                        pointerEvents="none"
                        style={[styles.dot, { left: `${(t / durationSeconds) * 100}%` }]}
                    />
                ))}
                <Animated.View style={[styles.thumb, thumbStyle]} pointerEvents="none" />
            </Animated.View>
        </GestureDetector>
    );
};

// ============================================================================
// GLYPH BUTTON (custom SVG icons; IconButton only takes Feather names)
// ============================================================================

/**
 * ±N seconds. The ring kicks a quarter-turn-ish the way time moves and springs back, so each
 * tap is felt as motion in the direction of the seek; the number stays still and readable.
 */
const SkipButton: FC<{ seconds: number; forward?: boolean; onPress: () => void }> = ({ seconds, forward = false, onPress }) => {
    const spin = useSharedValue(0);
    const ringStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));
    return (
        <Touchable
            onPress={() => {
                spin.value = withSequence(withSpring(forward ? 28 : -28, motion.press), withSpring(0, motion.spatial));
                onPress();
            }}
            onPlayer
            scaleTo={0.92}
            style={styles.jump}
            accessibilityRole="button"
            accessibilityLabel={`${forward ? 'Forward' : 'Back'} ${seconds} seconds`}
        >
            <Animated.View style={ringStyle}>
                <SkipRingIcon size={32} forward={forward} />
            </Animated.View>
            <Text style={styles.jumpText}>{seconds}</Text>
        </Touchable>
    );
};

const GlyphButton: FC<{
    onPress: () => void;
    label: string;
    active?: boolean;
    children: (color: string) => React.ReactNode;
}> = ({ onPress, label, active, children }) => (
    <Touchable
        onPress={onPress}
        onPlayer
        hitSlop={4}
        scaleTo={0.9}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: !!active }}
        style={styles.glyph}
    >
        {/* On: the icon's filled form plus a dot under it. Quieter than a solid disc. */}
        {children(colors.text)}
        {active && <View style={styles.glyphDot} />}
    </Touchable>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface PlayerControlsProps {
    showControls: boolean;
    title: string;
    /** Episode or folder line under the title. */
    subtitle?: string;
    onBack: () => void;
    onOpenSubtitles: () => void;
    /** Audio tracks: switched about as often as subtitles, so it sits next to them. */
    onOpenAudio: () => void;
    onAddBookmark?: () => void;
    /** Speed chip and ⋮ both open the Playback panel. */
    onOpenPlayback: () => void;
    playbackRate: number;
    paused: boolean;
    onTogglePlayPause: () => void;
    currentTime: SharedValue<number>;
    duration: SharedValue<number>;
    currentTimeSeconds?: number;
    durationSeconds?: number;
    seekPreviewTime: SharedValue<number>;
    isScrubbingShared: SharedValue<boolean>;
    /** Horizontal swipe-seek on the video: shows this bar in its scrubbing state. */
    swipeSeeking: SharedValue<boolean>;
    swipeSeekStart: SharedValue<number>;
    screenReaderEnabled?: boolean;
    onSeekStart: () => void;
    onSeek: (val: number) => void;
    onSeekComplete: (val: number) => void;
    bookmarks?: number[];
    buffering?: boolean;
    isLandscape: boolean;
    insets: EdgeInsets;
    onOpenBookmarks?: () => void;
    onOpenPlaylist?: () => void;
    onNext?: () => void;
    onJumpBackward: () => void;
    onJumpForward: () => void;
    onLockScreen: () => void;
    /** Night mode and mute lead the bottom row; the lock has the left edge to itself. */
    nightModeActive?: boolean;
    onToggleNightMode?: () => void;
    muted?: boolean;
    onToggleMute?: () => void;
    orientationLocked: boolean;
    onToggleOrientationLock: () => void;
    onToggleResizeMode: () => void;
    resizeMode: string;
    onEnterPip?: () => void;
    showSeekButtons?: boolean;
    seekDuration?: number;
    /** Colour enhancement: used every session, so it lives on the bar. */
    videoEnhancement?: boolean;
    onToggleVideoEnhancement?: () => void;
}

const NO_BOOKMARKS: number[] = [];
const SEEK_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }];

export const PlayerControls: FC<PlayerControlsProps> = React.memo(({
    showControls, title, subtitle, onBack, onOpenSubtitles, onOpenAudio, onAddBookmark, onOpenPlayback, playbackRate,
    paused, onTogglePlayPause, currentTime, duration, currentTimeSeconds = 0, durationSeconds = 0,
    seekPreviewTime, isScrubbingShared, swipeSeeking, swipeSeekStart, screenReaderEnabled = false,
    onSeekStart, onSeek, onSeekComplete, bookmarks = NO_BOOKMARKS, buffering = false, isLandscape, insets,
    onOpenBookmarks, onOpenPlaylist, onNext, onJumpBackward, onJumpForward,
    onLockScreen, nightModeActive = false, onToggleNightMode, muted = false, onToggleMute, orientationLocked, onToggleOrientationLock, onToggleResizeMode, resizeMode, onEnterPip,
    showSeekButtons = false, seekDuration = 10, videoEnhancement = false, onToggleVideoEnhancement,
}) => {

    const dragging = useSharedValue(false);
    const grow = useDerivedValue<number>(() => withSpring(dragging.value || swipeSeeking.value ? 1 : 0, motion.spatial));
    // Everything except the bar steps aside while scrubbing.
    const othersStyle = useAnimatedStyle(() => ({ opacity: 1 - grow.value }));

    // A swipe-seek brings the bar up even with controls hidden, and takes it away again after.
    const overlayStyle = useAnimatedStyle(() => {
        const visible = showControls || swipeSeeking.value;
        return { opacity: withTiming(visible ? 1 : 0, { duration: visible ? motion.fadeIn : motion.fadeOut }) };
    }, [showControls]);

    const playing = useDerivedValue(() => withTiming(paused ? 0 : 1, { duration: motion.fadeIn }), [paused]);
    const playGlyphStyle = useAnimatedStyle(() => ({ opacity: 1 - playing.value }));
    const pauseGlyphStyle = useAnimatedStyle(() => ({ opacity: playing.value }));

    // -1 until a duration exists, so the labels read --:-- rather than a confident 00:00.
    const elapsed = useDerivedValue(() => {
        if (duration.value <= 0) {return -1;}
        return isScrubbingShared.value ? seekPreviewTime.value : currentTime.value;
    });
    const remaining = useDerivedValue(() => {
        if (duration.value <= 0) {return -1;}
        return Math.max(0, duration.value - elapsed.value);
    });
    const remainingFormatter = useCallback((val: number) => {
        'worklet';
        return val < 0 ? formatClock(val) : `-${formatClock(val)}`;
    }, []);

    const hasDuration = durationSeconds > 0;
    const fallbackElapsed = hasDuration ? formatClock(currentTimeSeconds) : '--:--';
    const fallbackRemaining = hasDuration ? `-${formatClock(Math.max(0, durationSeconds - currentTimeSeconds))}` : '--:--';
    // The total never changes during playback, so it is plain text beside the live elapsed time.
    const totalText = hasDuration ? formatClock(durationSeconds) : '--:--';

    const ResizeModeIcon = getResizeModeIcon(resizeMode);
    const bottomPad = Math.max(insets.bottom, metrics.space.sm);

    return (
        <Animated.View
            style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]}
            pointerEvents={showControls ? 'box-none' : 'none'}
        >
            <Animated.View style={[styles.topScrim, othersStyle]} pointerEvents="none">
                <Gradient colors={TOP_SCRIM} style={{ height: 96 + insets.top }} />
            </Animated.View>
            <Gradient colors={BOTTOM_SCRIM} style={[styles.bottomScrim, { height: 130 + bottomPad }]} pointerEvents="none" />

            {/* Top bar */}
            <Animated.View
                style={[styles.topBar, { paddingTop: insets.top + metrics.space.xs, paddingLeft: metrics.space.sm + insets.left, paddingRight: metrics.space.sm + insets.right }, othersStyle]}
            >
                <IconButton icon="arrow-left" onPress={onBack} accessibilityLabel="Back" onPlayer />
                <View style={styles.titleBlock}>
                    <Text numberOfLines={1} style={styles.title}>{title || 'Video'}</Text>
                    {!!subtitle && <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text>}
                </View>
                {/* Portrait keeps the title room; enhancement is in the Playback panel too. */}
                {onToggleVideoEnhancement && (
                    <GlyphButton onPress={onToggleVideoEnhancement} label="Colour enhancement" active={videoEnhancement}>
                        {c => <VisualEnhancementIcon size={22} color={c} active={videoEnhancement} />}
                    </GlyphButton>
                )}
                <GlyphButton onPress={onOpenAudio} label="Audio track">
                    {c => <AudioIcon size={22} color={c} />}
                </GlyphButton>
                <GlyphButton onPress={onOpenSubtitles} label="Subtitles">
                    {c => <SubtitleIcon size={22} color={c} />}
                </GlyphButton>
                {onAddBookmark && isLandscape && (
                    <IconButton icon="bookmark" onPress={onAddBookmark} accessibilityLabel="Add bookmark" onPlayer />
                )}
                {/* Portrait: ⋮ opens the same panel, and the title needs the room. */}
                {isLandscape && (
                    <Touchable
                        onPress={onOpenPlayback}
                        onPlayer
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Playback speed ${formatRate(playbackRate)}`}
                        style={styles.speedChip}
                    >
                        <Text style={styles.speedText}>{formatRate(playbackRate)}</Text>
                    </Touchable>
                )}
                <IconButton icon="more-vertical" onPress={onOpenPlayback} accessibilityLabel="Playback settings" onPlayer />
            </Animated.View>

            {/* Lock, alone on the left edge (clear of a landscape camera cutout), vertically centred where the thumb rests */}
            <Animated.View style={[styles.rail, { left: metrics.space.sm + insets.left }, othersStyle]} pointerEvents="box-none">
                {/* Small and bare, as it always was: an 18 px glyph about 20 dp from the edge. */}
                <IconButton icon="lock" iconSize={18} onPress={onLockScreen} accessibilityLabel="Lock screen" onPlayer />
            </Animated.View>

            {/* Centre transport */}
            <Animated.View style={[styles.center, othersStyle]} pointerEvents="box-none">
                {showSeekButtons && (
                    <SkipButton seconds={seekDuration} onPress={onJumpBackward} />
                )}
                <Touchable onPress={onTogglePlayPause} onPlayer scaleTo={0.9} style={styles.play} accessibilityRole="button" accessibilityLabel={paused ? 'Play' : 'Pause'}>
                    <Animated.View style={[styles.glyphLayer, playGlyphStyle]}>
                        <Feather name="play" size={46} color={colors.text} />
                    </Animated.View>
                    <Animated.View style={[styles.glyphLayer, pauseGlyphStyle]}>
                        <Feather name="pause" size={46} color={colors.text} />
                    </Animated.View>
                </Touchable>
                {showSeekButtons && (
                    <SkipButton forward seconds={seekDuration} onPress={onJumpForward} />
                )}
            </Animated.View>

            {/* Bottom */}
            <View
                style={[styles.bottom, { paddingBottom: bottomPad, paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right }]}
                pointerEvents="box-none"
            >
                <Animated.View style={[styles.timeRow, othersStyle]}>
                    {/* Elapsed on the left; time left / total on the right: all three, no tap to find them. */}
                    <ReanimatedText value={elapsed} formatter={formatClock} fallbackText={fallbackElapsed} />
                    <View style={styles.endGroup}>
                        <ReanimatedText value={remaining} formatter={remainingFormatter} fallbackText={fallbackRemaining} style={styles.timeMuted} />
                        <Text style={styles.time}> / {totalText}</Text>
                    </View>
                </Animated.View>

                <SeekBar
                    currentTime={currentTime}
                    duration={duration}
                    isScrubbing={isScrubbingShared}
                    seekPreviewTime={seekPreviewTime}
                    grow={grow}
                    dragging={dragging}
                    swipeSeeking={swipeSeeking}
                    swipeSeekStart={swipeSeekStart}
                    screenReader={screenReaderEnabled}
                    onStepBackward={onJumpBackward}
                    onStepForward={onJumpForward}
                    bookmarks={bookmarks}
                    durationSeconds={durationSeconds}
                    buffering={buffering}
                    onSeekStart={onSeekStart}
                    onSeek={onSeek}
                    onSeekComplete={onSeekComplete}
                />

                <Animated.View style={[styles.tools, othersStyle]}>
                    {onToggleNightMode && (
                        <GlyphButton onPress={onToggleNightMode} label="Night mode" active={nightModeActive}>
                            {c => <NightModeIcon size={20} color={c} active={nightModeActive} />}
                        </GlyphButton>
                    )}
                    {onToggleMute && (
                        <GlyphButton onPress={onToggleMute} label={muted ? 'Unmute' : 'Mute'} active={muted}>
                            {c => <Feather name={muted ? 'volume-x' : 'volume-2'} size={22} color={c} />}
                        </GlyphButton>
                    )}
                    {onOpenPlaylist && (
                        <IconButton icon="list" onPress={onOpenPlaylist} accessibilityLabel="Playlist" onPlayer />
                    )}
                    {onOpenBookmarks && isLandscape && (
                        <GlyphButton onPress={onOpenBookmarks} label="Bookmarks">
                            {c => <BookmarkListIcon size={22} color={c} />}
                        </GlyphButton>
                    )}
                    <View style={styles.flex} />
                    <GlyphButton onPress={onToggleOrientationLock} label="Lock rotation" active={orientationLocked}>
                        {c => <OrientationLockIcon size={20} color={c} locked={orientationLocked} />}
                    </GlyphButton>
                    {/* Icon and name, like Next: the current mode is readable without cycling through them. */}
                    <Touchable
                        onPress={onToggleResizeMode}
                        onPlayer
                        scaleTo={0.94}
                        accessibilityRole="button"
                        accessibilityLabel={`Display mode: ${getResizeModeLabel(resizeMode)}. Tap to change`}
                        style={styles.modePill}
                    >
                        <ResizeModeIcon size={18} color={colors.text} />
                        <Text style={styles.modeText}>{getResizeModeLabel(resizeMode)}</Text>
                    </Touchable>
                    {onEnterPip && (
                        <GlyphButton onPress={onEnterPip} label="Picture in picture">
                            {c => <PipIcon size={20} color={c} />}
                        </GlyphButton>
                    )}
                    {onNext && !isLandscape && (
                        <IconButton icon="skip-forward" onPress={onNext} accessibilityLabel="Next video" onPlayer />
                    )}
                    {onNext && isLandscape && (
                        <Button
                            label="Next"
                            icon="skip-forward"
                            variant="secondary"
                            onPress={onNext}
                            onPlayer
                            style={styles.next}
                        />
                    )}
                </Animated.View>
            </View>
        </Animated.View>
    );
}, (prev, next) => (
    prev.showControls === next.showControls &&
    prev.paused === next.paused &&
    prev.title === next.title &&
    prev.subtitle === next.subtitle &&
    prev.isLandscape === next.isLandscape &&
    prev.insets === next.insets &&
    prev.orientationLocked === next.orientationLocked &&
    prev.resizeMode === next.resizeMode &&
    prev.playbackRate === next.playbackRate &&
    prev.onNext === next.onNext &&
    prev.onAddBookmark === next.onAddBookmark &&
    prev.bookmarks === next.bookmarks &&
    prev.buffering === next.buffering &&
    prev.durationSeconds === next.durationSeconds &&
    prev.showSeekButtons === next.showSeekButtons &&
    prev.seekDuration === next.seekDuration &&
    prev.videoEnhancement === next.videoEnhancement &&
    prev.nightModeActive === next.nightModeActive &&
    prev.muted === next.muted &&
    prev.screenReaderEnabled === next.screenReaderEnabled
));

PlayerControls.displayName = 'PlayerControls';

const styles = StyleSheet.create({
    overlay: { zIndex: 10 },
    flex: { flex: 1 },
    topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
    bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0 },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.xs,
    },
    titleBlock: { flex: 1, marginHorizontal: metrics.space.xs },
    title: { ...type.row, color: colors.text },
    subtitle: { fontSize: 11.5, lineHeight: 15, color: colors.textSecondary },
    speedChip: {
        height: 28,
        minWidth: 40,
        paddingHorizontal: metrics.space.sm,
        borderRadius: metrics.radius.pill,
        borderWidth: 1.5,
        borderColor: colors.text,
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: metrics.space.xs,
    },
    speedText: { ...type.label, color: colors.text, fontVariant: ['tabular-nums'] },
    glyph: {
        width: 40,
        height: 40,
        borderRadius: metrics.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
    },
    glyphDot: {
        position: 'absolute',
        bottom: 1,
        width: 4,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.text,
    },
    rail: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
    center: {
        ...StyleSheet.absoluteFill,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: metrics.space.xxl,
    },
    jump: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
    jumpText: {
        position: 'absolute',
        // The ring's centre sits slightly below the box's middle.
        marginTop: 2,
        fontSize: 10.5,
        fontWeight: '700',
        letterSpacing: -0.3,
        color: colors.text,
        fontVariant: ['tabular-nums'],
        includeFontPadding: false,
    },
    play: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
    glyphLayer: { position: 'absolute' },
    bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
    timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
    time: { ...type.caption, color: colors.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
    timeMuted: { color: colors.textSecondary },
    endGroup: { flexDirection: 'row' },
    seekBar: { height: 28, justifyContent: 'center' },
    track: { backgroundColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' },
    fill: { ...StyleSheet.absoluteFill, backgroundColor: colors.primary, transformOrigin: 'left' },
    loading: { position: 'absolute', top: 0, bottom: 0, width: '30%', backgroundColor: colors.primary },
    // A tick taller than the track, outlined so it reads on both the played and unplayed parts.
    dot: {
        position: 'absolute',
        top: 8,
        width: 3,
        height: 12,
        marginLeft: -1.5,
        borderRadius: 1.5,
        backgroundColor: colors.text,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: HUD_PILL,
    },
    thumb: { position: 'absolute', left: 0, backgroundColor: colors.primary },
    bubble: {
        position: 'absolute',
        left: 0,
        bottom: 36,
        width: BUBBLE_WIDTH,
        paddingVertical: metrics.space.sm,
        borderRadius: metrics.radius.md,
        backgroundColor: colors.cardElevated,
        alignItems: 'center',
    },
    bubbleTime: { ...type.row, color: colors.text },
    bubbleDelta: { ...type.caption, color: colors.textSecondary },
    tools: { flexDirection: 'row', alignItems: 'center', minHeight: metrics.touch },
    next: { marginLeft: metrics.space.sm },
    modePill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.sm,
        height: 40,
        paddingHorizontal: 14,
        borderRadius: 20,
        backgroundColor: colors.fill,
        marginHorizontal: metrics.space.xs,
    },
    modeText: { ...type.label, color: colors.text },
});
