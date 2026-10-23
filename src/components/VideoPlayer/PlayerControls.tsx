import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, useWindowDimensions, type HostInstance } from 'react-native';
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
import { cutoutInset, type CutoutRect } from '@/utils/cutoutInset';
import { crossesMark, nearestMark } from '@/utils/seekMarks';
import { IS_TV } from '@/utils/tv';

const { colors } = playerTheme;

const TOP_SCRIM = ['rgba(0,0,0,0.62)', 'rgba(0,0,0,0)'];
const BOTTOM_SCRIM = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)'];
const BUBBLE_WIDTH = 96;
/** Room for a chapter name under the time. */
const CHAPTER_BUBBLE_WIDTH = 168;

export interface SeekChapter { title: string; start: number }

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
    /** False while the label can't be seen: no updates then, and the current text on return. */
    live?: SharedValue<boolean>;
    numberOfLines?: number;
}

const ReanimatedText: React.FC<ReanimatedTextProps> = ({ value, formatter, style, fallbackText, live, numberOfLines }) => {
    const [text, setText] = useState(fallbackText ?? '');
    const updateText = useCallback((next: string) => setText(prev => prev === next ? prev : next), []);

    useEffect(() => {
        if (fallbackText !== undefined) {updateText(fallbackText);}
    }, [fallbackText, updateText]);

    useAnimatedReaction(
        () => (!live || live.value ? formatter(value.value) : null),
        (next, prev) => {
            if (next !== null && next !== prev) {runOnJS(updateText)(next);}
        });

    return <Text maxFontSizeMultiplier={metrics.playerFontScale} style={[styles.time, style]} numberOfLines={numberOfLines}>{text}</Text>;
};

// ============================================================================
// SEEK BAR
// ============================================================================

/**
 * How close a release has to be to a bookmark or chapter start to land on it: 1.5× the
 * finger's own scatter in 1D touch, σa = 0.94 mm (Bi, Li & Zhai, FFitts law, CHI 2013).
 * That catches 87% of releases aimed at a mark (1σ caught 68% and felt like missing), and
 * stays about Android's touch slop (8 dp), the travel it counts as a finger holding still.
 * Only on release: while dragging the thumb stays under the finger and marks just tick.
 */
const SNAP_PX = 1.5 * 0.94 * (160 / 25.4); // ≈ 8.9 dp
/**
 * Lifting faster than this (dp/s) is a fling, not aiming: the finger is through the snap zone
 * before sight could correct it (~140 ms, Elliott & Allard 1985).
 */
const SNAP_MAX_VELOCITY = (2 * SNAP_PX) / 0.14; // ≈ 127 dp/s
/** Half the gap between chapter segments. */
const SEGMENT_INSET = 1.5;

/**
 * One chapter's stretch of the track, from..to as fractions of the duration, with its own
 * rounded ends. Placed by time, not flexed, so the gaps never push the fill off the thumb.
 */
const TrackSegment: FC<{
    from: number;
    to: number;
    progress: SharedValue<number>;
    grow: SharedValue<number>;
    loading: SharedValue<number>;
    buffering: boolean;
}> = ({ from, to, progress, grow, loading, buffering }) => {
    const len = to - from;
    const shapeStyle = useAnimatedStyle(() => ({ borderRadius: (4 + 4 * grow.value) / 2 }));
    // Scaled, not shifted by the measured width: trackWidth only updates in onLayout, a
    // frame after a rotation resizes the bar, and a shift by the old width showed the
    // difference as a white block.
    const fillStyle = useAnimatedStyle(() => ({
        transform: [{ scaleX: Math.max(0, Math.min(1, (progress.value - from) / len)) }],
    }));
    // The one sweep across the whole bar, seen through this segment.
    const loadingStyle = useAnimatedStyle(() => ({
        opacity: buffering ? 1 : 0,
        left: `${((loading.value * 1.3 - 0.3 - from) / len) * 100}%`,
        width: `${(0.3 / len) * 100}%`,
    }));
    const placement = {
        left: `${from * 100}%` as const,
        right: `${(1 - to) * 100}%` as const,
        marginLeft: from > 0 ? SEGMENT_INSET : 0,
        marginRight: to < 1 ? SEGMENT_INSET : 0,
    };
    return (
        <Animated.View style={[styles.track, placement, shapeStyle]}>
            <Animated.View style={[styles.fill, fillStyle]} />
            {buffering && <Animated.View style={[styles.loading, loadingStyle]} />}
        </Animated.View>
    );
};

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
    /** By start, in seconds: a gap in the track at each, and the name while scrubbing. */
    chapters: SeekChapter[];
    durationSeconds: number;
    buffering: boolean;
    onSeekStart: () => void;
    onSeek: (val: number) => void;
    onSeekComplete: (val: number) => void;
    /** TV: the bar takes remote focus here; Left / Right on it scrub (TvRemoteModule). */
    focusRef?: React.RefObject<HostInstance | null>;
}

const SeekBar: React.FC<SeekBarProps> = ({
    currentTime, duration, isScrubbing, seekPreviewTime, grow, dragging, swipeSeeking, swipeSeekStart,
    screenReader, onStepBackward, onStepForward,
    bookmarks, chapters, durationSeconds, buffering, onSeekStart, onSeek, onSeekComplete, focusRef,
}) => {
    // Remote focus: a ring around the thumb, as on the other controls.
    const [tvFocused, setTvFocused] = useState(false);
    // Dragging over a bookmark or a chapter start ticks the same way.
    const marks = useMemo(() => [...bookmarks, ...chapters.map(c => c.start)], [bookmarks, chapters]);
    const bubbleWidth = chapters.length > 0 ? CHAPTER_BUBBLE_WIDTH : BUBBLE_WIDTH;
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

    const trackStyle = useAnimatedStyle(() => ({ height: 4 + 4 * grow.value }));
    // Fractions of the duration where each segment ends; no chapters is one segment.
    const edges = useMemo(() => {
        const cuts = durationSeconds > 0
            ? chapters.map(c => c.start / durationSeconds).filter(f => f > 0 && f < 1)
            : [];
        return [0, ...cuts, 1];
    }, [chapters, durationSeconds]);
    const thumbStyle = useAnimatedStyle(() => {
        const size = (tvFocused ? 22 : 14) + 6 * grow.value;
        return {
            width: size,
            height: size,
            borderRadius: size / 2,
            left: `${progress.value * 100}%`,
            transform: [{ translateX: -size / 2 }],
        };
    }, [tvFocused]);
    const bubbleStyle = useAnimatedStyle(() => {
        const half = bubbleWidth / 2;
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
            width: bubbleWidth,
            opacity: grow.value,
            left: `${progress.value * 100}%`,
            transform: [{ translateX: offset }],
        };
    });
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

    const chapterAt = (t: number) => {
        'worklet';
        let title = '';
        for (let i = 0; i < chapters.length && chapters[i].start <= t; i++) {title = chapters[i].title;}
        return title;
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
            if (crossesMark(marks, prev, next)) {runOnJS(haptic)('segmentTick');}
            const now = Date.now();
            if (now - lastSeekDispatchAt.value >= 33) {
                lastSeekDispatchAt.value = now;
                runOnJS(onSeek)(next);
            }
        })
        .onFinalize((e) => {
            'worklet';
            if (!dragging.value) {return;}
            dragging.value = false;
            if (Math.abs(e.velocityX) < SNAP_MAX_VELOCITY) {
                const mark = nearestMark(marks, seekPreviewTime.value, (SNAP_PX / trackWidth.value) * duration.value);
                if (mark >= 0) {seekPreviewTime.value = mark;}
            }
            // isScrubbing stays true until the seek lands, so the bar does not snap back.
            runOnJS(onSeekComplete)(seekPreviewTime.value);
        });

    return (
        <GestureDetector gesture={pan}>
            <Animated.View
                ref={focusRef}
                focusable={IS_TV || undefined}
                onFocus={IS_TV ? () => setTvFocused(true) : undefined}
                onBlur={IS_TV ? () => setTvFocused(false) : undefined}
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
                    {chapters.length > 0 && (
                        <ReanimatedText value={seekPreviewTime} formatter={chapterAt} style={styles.bubbleChapter} numberOfLines={1} />
                    )}
                </Animated.View>
                <Animated.View style={trackStyle}>
                    {edges.slice(1).map((to, i) => (
                        <TrackSegment
                            key={edges[i]}
                            from={edges[i]}
                            to={to}
                            progress={progress}
                            grow={grow}
                            loading={loading}
                            buffering={buffering}
                        />
                    ))}
                </Animated.View>
                {durationSeconds > 0 && bookmarks.map(t => (
                    <View
                        key={t}
                        pointerEvents="none"
                        style={[styles.dot, { left: `${(t / durationSeconds) * 100}%` }]}
                    />
                ))}
                <Animated.View style={[styles.thumb, tvFocused && styles.thumbFocused, thumbStyle]} pointerEvents="none" />
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
            style={[styles.jump, IS_TV && styles.jumpTv]}
            accessibilityRole="button"
            accessibilityLabel={`${forward ? 'Forward' : 'Back'} ${seconds} seconds`}
        >
            <Animated.View style={ringStyle}>
                <SkipRingIcon size={32} forward={forward} />
            </Animated.View>
            <Text maxFontSizeMultiplier={metrics.playerFontScale} style={styles.jumpText}>{seconds}</Text>
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
    chapters?: SeekChapter[];
    buffering?: boolean;
    isLandscape: boolean;
    insets: EdgeInsets;
    /** Camera cutout rects; null until measured (or on an APK before API 9). */
    cutouts: CutoutRect[] | null;
    onOpenBookmarks?: () => void;
    onOpenPlaylist?: () => void;
    onPrevious?: () => void;
    onNext?: () => void;
    onJumpBackward: () => void;
    onJumpForward: () => void;
    /** Absent on TV, as are rotation lock and PiP: phone-only. */
    onLockScreen?: () => void;
    /** Night mode and mute lead the bottom row; the lock has the left edge to itself. */
    nightModeActive?: boolean;
    onToggleNightMode?: () => void;
    muted?: boolean;
    onToggleMute?: () => void;
    orientationLocked: boolean;
    onToggleOrientationLock?: () => void;
    onToggleResizeMode: () => void;
    resizeMode: string;
    onEnterPip?: () => void;
    showSeekButtons?: boolean;
    seekDuration?: number;
    /** Colour enhancement: used every session, so it lives on the bar. */
    videoEnhancement?: boolean;
    onToggleVideoEnhancement?: () => void;
    /** Where the TV remote puts focus: Up and OK on Play, Down on the seek bar. */
    playRef?: React.RefObject<HostInstance | null>;
    seekBarRef?: React.RefObject<HostInstance | null>;
}

const NO_BOOKMARKS: number[] = [];
const NO_CHAPTERS: SeekChapter[] = [];
const SEEK_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }];

type Handler = (...args: unknown[]) => unknown;

/**
 * The screen's handlers change identity with state the controls never show (the HUD on
 * every gesture step, panels, delays), so the view below skips those renders. It gets
 * stable stand-ins that call the latest handler instead: skipping used to leave it holding
 * an old one, so Back saved an old audio track and Next carried old settings.
 */
export const PlayerControls: FC<PlayerControlsProps> = (props) => {
    const latest = useRef(props);
    latest.current = props;
    const standIns = useRef<Record<string, Handler>>({}).current;

    const forwarded: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
        if (typeof value === 'function') {
            standIns[key] ??= (...args) => (latest.current as unknown as Record<string, Handler | undefined>)[key]?.(...args);
            forwarded[key] = standIns[key];
        } else {
            forwarded[key] = value;
        }
    }
    return <PlayerControlsView {...(forwarded as unknown as PlayerControlsProps)} />;
};

const PlayerControlsView: FC<PlayerControlsProps> = React.memo(({
    showControls, title, subtitle, onBack, onOpenSubtitles, onOpenAudio, onAddBookmark, onOpenPlayback, playbackRate,
    paused, onTogglePlayPause, currentTime, duration, currentTimeSeconds = 0, durationSeconds = 0,
    seekPreviewTime, isScrubbingShared, swipeSeeking, swipeSeekStart, screenReaderEnabled = false,
    onSeekStart, onSeek, onSeekComplete, bookmarks = NO_BOOKMARKS, chapters = NO_CHAPTERS, buffering = false, isLandscape, insets, cutouts,
    onOpenBookmarks, onOpenPlaylist, onPrevious, onNext, onJumpBackward, onJumpForward,
    onLockScreen, nightModeActive = false, onToggleNightMode, muted = false, onToggleMute, orientationLocked, onToggleOrientationLock, onToggleResizeMode, resizeMode, onEnterPip,
    showSeekButtons = false, seekDuration = 10, videoEnhancement = false, onToggleVideoEnhancement,
    playRef, seekBarRef,
}) => {

    const dragging = useSharedValue(false);
    const grow = useDerivedValue<number>(() => withSpring(dragging.value || swipeSeeking.value ? 1 : 0, motion.spatial));
    // Everything except the bar steps aside while scrubbing.
    const othersStyle = useAnimatedStyle(() => ({ opacity: 1 - grow.value }));
    // The time labels re-render through React, so they only update while their row can be seen.
    const timeRowLive = useDerivedValue(() => showControls && grow.value < 1, [showControls]);

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
    // Each edge control clears the camera cutout only where it sits level with it, so beside
    // a punch hole the bars use the full width and just the lock steps in.
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const edge = (side: 'left' | 'right', top: number, bottom: number) => (
        isLandscape ? cutoutInset(side, insets[side], cutouts, windowWidth, top, bottom) : insets[side]
    );
    const topBarBottom = insets.top + 56;
    const bottomBarTop = windowHeight - 130 - bottomPad;
    const railMiddle = windowHeight / 2;

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
                style={[styles.topBar, { paddingTop: insets.top + metrics.space.xs, paddingLeft: metrics.space.xs + edge('left', 0, topBarBottom), paddingRight: metrics.space.xs + edge('right', 0, topBarBottom) }, othersStyle]}
            >
                <IconButton icon="arrow-left" onPress={onBack} accessibilityLabel="Back" onPlayer />
                <View style={styles.titleBlock}>
                    <Text maxFontSizeMultiplier={metrics.playerFontScale} numberOfLines={1} style={styles.title}>{title || 'Video'}</Text>
                    {!!subtitle && <Text maxFontSizeMultiplier={metrics.playerFontScale} numberOfLines={1} style={styles.subtitle}>{subtitle}</Text>}
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
                        <Text maxFontSizeMultiplier={metrics.playerFontScale} style={styles.speedText}>{formatRate(playbackRate)}</Text>
                    </Touchable>
                )}
                <IconButton
                    icon="more-vertical"
                    onPress={onOpenPlayback}
                    accessibilityLabel="Playback settings"
                    onPlayer
                />
            </Animated.View>

            {/* Lock, alone on the left edge (clear of a landscape camera cutout), vertically centred where the thumb rests */}
            {/* Portrait has no side room (the centre row reaches the edges), so its lock is in the tools row. */}
            {isLandscape && onLockScreen && (
                <Animated.View style={[styles.rail, { left: metrics.space.xs + edge('left', railMiddle - 24, railMiddle + 24) }, othersStyle]} pointerEvents="box-none">
                    {/* Small and bare, as it always was: an 18 px glyph about 20 dp from the edge. */}
                    <IconButton icon="lock" iconSize={18} onPress={onLockScreen} accessibilityLabel="Lock screen" onPlayer />
                </Animated.View>
            )}

            {/* Centre transport. Portrait's Previous / Next sit at the ends of the time row. */}
            <Animated.View style={[styles.center, !isLandscape && styles.centerPortrait, othersStyle]} pointerEvents="box-none">
                {showSeekButtons && (
                    <SkipButton seconds={seekDuration} onPress={onJumpBackward} />
                )}
                {/* The TV remote's focus target: kept as a view, so it can be found to focus Play inside it. */}
                <View ref={playRef} collapsable={false}>
                    {/* TV: focused as it mounts, before Android hands the new screen's focus to its first view, the back arrow. */}
                    <Touchable onPress={onTogglePlayPause} onPlayer scaleTo={0.9} preferFocus style={[styles.play, IS_TV && styles.playTv]} accessibilityRole="button" accessibilityLabel={paused ? 'Play' : 'Pause'}>
                        <Animated.View style={[styles.glyphLayer, playGlyphStyle]}>
                            <Feather name="play" size={46} color={colors.text} />
                        </Animated.View>
                        <Animated.View style={[styles.glyphLayer, pauseGlyphStyle]}>
                            <Feather name="pause" size={46} color={colors.text} />
                        </Animated.View>
                    </Touchable>
                </View>
                {showSeekButtons && (
                    <SkipButton forward seconds={seekDuration} onPress={onJumpForward} />
                )}
            </Animated.View>

            {/* Bottom */}
            <View
                style={[styles.bottom, { paddingBottom: bottomPad, paddingLeft: 20 + edge('left', bottomBarTop, windowHeight), paddingRight: 20 + edge('right', bottomBarTop, windowHeight) }]}
                pointerEvents="box-none"
            >
                <Animated.View style={[styles.timeRow, othersStyle]}>
                    {/* Elapsed on the left; time left / total on the right: all three, no tap to find them. */}
                    <View style={styles.endGroup}>
                        {!isLandscape && onPrevious && (
                            <IconButton icon="skip-back" iconSize={20} onPress={onPrevious} accessibilityLabel="Previous video" onPlayer />
                        )}
                        <ReanimatedText value={elapsed} formatter={formatClock} fallbackText={fallbackElapsed} live={timeRowLive} />
                    </View>
                    <View style={styles.endGroup}>
                        <ReanimatedText value={remaining} formatter={remainingFormatter} fallbackText={fallbackRemaining} style={styles.timeMuted} live={timeRowLive} />
                        <Text maxFontSizeMultiplier={metrics.playerFontScale} style={styles.time}> / {totalText}</Text>
                        {!isLandscape && onNext && (
                            <IconButton icon="skip-forward" iconSize={20} onPress={onNext} accessibilityLabel="Next video" onPlayer />
                        )}
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
                    chapters={chapters}
                    durationSeconds={durationSeconds}
                    buffering={buffering}
                    onSeekStart={onSeekStart}
                    onSeek={onSeek}
                    onSeekComplete={onSeekComplete}
                    focusRef={seekBarRef}
                />

                <Animated.View style={[styles.tools, othersStyle]}>
                    {/* Landscape: Previous and Next bracket the row, one at each end. */}
                    {onPrevious && isLandscape && (
                        <Button
                            label="Previous"
                            icon="skip-back"
                            variant="secondary"
                            onPress={onPrevious}
                            onPlayer
                            style={styles.previous}
                        />
                    )}
                    {!isLandscape && onLockScreen && (
                        <IconButton icon="lock" iconSize={18} onPress={onLockScreen} accessibilityLabel="Lock screen" onPlayer />
                    )}
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
                    {onToggleOrientationLock && (
                        <GlyphButton onPress={onToggleOrientationLock} label="Lock rotation" active={orientationLocked}>
                            {c => <OrientationLockIcon size={20} color={c} locked={orientationLocked} />}
                        </GlyphButton>
                    )}
                    {/* Icon and name, like Next: the current mode is readable without cycling through them.
                        Not on TV: its video plane ignores display modes (docs/android-tv.md). */}
                    {!IS_TV && <Touchable
                        onPress={onToggleResizeMode}
                        onPlayer
                        scaleTo={0.94}
                        accessibilityRole="button"
                        accessibilityLabel={`Display mode: ${getResizeModeLabel(resizeMode)}. Tap to change`}
                        style={[styles.modePill, !isLandscape && styles.modePillIcon]}
                    >
                        <ResizeModeIcon size={18} color={colors.text} />
                        {/* Portrait's row has room for the icon only; a change still names the mode in the HUD. */}
                        {isLandscape && <Text maxFontSizeMultiplier={metrics.playerFontScale} style={styles.modeText}>{getResizeModeLabel(resizeMode)}</Text>}
                    </Touchable>}
                    {onEnterPip && (
                        <GlyphButton onPress={onEnterPip} label="Picture in picture">
                            {c => <PipIcon size={20} color={c} />}
                        </GlyphButton>
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
}, (prev, next) => {
    // currentTimeSeconds is read from a ref on every screen render; the bar's clock runs on
    // shared values, and the fallback label only needs it when something else re-renders.
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    keys.delete('currentTimeSeconds');
    return [...keys].every(k => prev[k as keyof PlayerControlsProps] === next[k as keyof PlayerControlsProps]);
});

PlayerControlsView.displayName = 'PlayerControlsView';

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
    // Previous, both skips, Play and Next: 264 dp of buttons, which fits a 360 dp screen only at this gap.
    centerPortrait: { gap: metrics.space.lg },
    jump: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
    // TV: a squircle plate (about 30% radius), so the focus ring, which follows it, is one too.
    jumpTv: { borderRadius: 18, backgroundColor: colors.fill },
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
    playTv: { borderRadius: 22, backgroundColor: colors.fill },
    glyphLayer: { position: 'absolute' },
    bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
    timeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    time: { ...type.caption, color: colors.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
    timeMuted: { color: colors.textSecondary },
    endGroup: { flexDirection: 'row', alignItems: 'center' },
    seekBar: { height: 28, justifyContent: 'center' },
    track: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' },
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
    thumbFocused: { borderWidth: 3, borderColor: colors.text },
    bubble: {
        position: 'absolute',
        left: 0,
        bottom: 36,
        paddingVertical: metrics.space.sm,
        borderRadius: metrics.radius.md,
        backgroundColor: colors.cardElevated,
        alignItems: 'center',
    },
    bubbleTime: { ...type.row, color: colors.text },
    bubbleDelta: { ...type.caption, color: colors.textSecondary },
    bubbleChapter: { ...type.caption, color: colors.text, paddingHorizontal: metrics.space.sm },    tools: { flexDirection: 'row', alignItems: 'center', minHeight: metrics.touch },
    next: { marginLeft: metrics.space.sm },
    previous: { marginRight: metrics.space.sm },
    modePillIcon: { width: 40, paddingHorizontal: 0, justifyContent: 'center' },
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
