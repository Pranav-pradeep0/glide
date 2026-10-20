import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import Animated, {
    FadeOut,
    ReduceMotion,
    SharedValue,
    useAnimatedStyle,
    useAnimatedReaction,
    useReducedMotion,
    runOnJS,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { DoubleTapRipple, PlayPauseFlash } from './DoubleTapRipple';
import { formatRate, getResizeModeIcon, getResizeModeLabel } from './PlayerIcons';
import { haptic } from '@/native/HapticModule';
import { metrics, motion, playerTheme, type } from '@/theme/theme';
import { HUD_PILL } from '@/theme/colors';

const { colors } = playerTheme;

/** Top bar height below the inset (padding + 48 dp row): the status slot stays clear of it. */
const TOP_BAR = metrics.space.xs + metrics.touch;

/** Mirrors a worklet-formatted shared value into React state, re-rendering only on change. */
const useWorkletText = (value: SharedValue<number>, formatter: (val: number) => string) => {
    const [text, setText] = useState('');
    const update = useCallback((next: string) => setText(prev => prev === next ? prev : next), []);
    useAnimatedReaction(
        () => formatter(value.value),
        (next, prev) => {
            if (next !== prev) {runOnJS(update)(next);}
        });
    return text;
};

const percent = (val: number) => {
    'worklet';
    return `${Math.round(val * 100)}%`;
};

const volumeIcon = (val: number) => {
    'worklet';
    return val <= 0 ? 'volume-x' : val < 0.5 ? 'volume-1' : 'volume-2';
};

const sunIcon = () => {
    'worklet';
    return 'sun';
};

interface LevelProps {
    value: SharedValue<number>;
    kind: 'volume' | 'brightness';
    max: number;
}

/** [icon] [bar] [value]. One segment tick per edge reached. */
const Level: React.FC<LevelProps> = React.memo(({ value, kind, max }) => {
    const text = useWorkletText(value, percent);
    const icon = useWorkletText(value, kind === 'volume' ? volumeIcon : sunIcon) as 'sun' | 'volume-x' | 'volume-1' | 'volume-2';

    const fillStyle = useAnimatedStyle(() => ({
        width: `${Math.min(1, value.value / max) * 100}%`,
        // Only a boost past 100% gets a warning colour: it can distort audio.
        backgroundColor: value.value > 1 ? colors.warning : colors.text,
    }));

    useAnimatedReaction(
        () => (value.value <= 0 ? -1 : value.value >= max ? 1 : 0),
        (edge, prev) => {
            if (prev !== null && edge !== 0 && edge !== prev) {runOnJS(haptic)('segmentTick');}
        });

    return (
        <>
            {!!icon && <Feather name={icon} size={18} color={colors.text} />}
            <View style={styles.track}>
                <View style={styles.trackBg} />
                <Animated.View style={[styles.fill, fillStyle]} />
            </View>
            <Text maxFontSizeMultiplier={metrics.playerFontScale} style={styles.value}>{text}</Text>
        </>
    );
});

/** The one status slot: spring in from 0.96, fade 120 in / 280 out. */
const StatusPill: React.FC<{ top: number; children: React.ReactNode }> = ({ top, children }) => {
    const reduceMotion = useReducedMotion();
    const entering = useCallback(() => {
        'worklet';
        return {
            initialValues: { opacity: 0, transform: [{ scale: reduceMotion ? 1 : 0.96 }] },
            animations: {
                opacity: withTiming(1, { duration: motion.fadeIn, reduceMotion: ReduceMotion.Never }),
                transform: [{ scale: withSpring(1, motion.press) }],
            },
        };
    }, [reduceMotion]);

    return (
        <View style={[styles.slot, { top }]} pointerEvents="none">
            <Animated.View
                style={styles.pill}
                entering={entering}
                exiting={FadeOut.duration(motion.fadeOut).reduceMotion(ReduceMotion.Never)}
            >
                {children}
            </Animated.View>
        </View>
    );
};

interface VideoHUDProps {
    showBrightnessHUD: boolean;
    brightnessHUD: SharedValue<number>;
    showVolumeHUD: boolean;
    volumeHUD: SharedValue<number>;
    maxVolume?: number;
    showSpeedHUD: boolean;
    playbackRate: number;
    showResizeHUD: boolean;
    resizeMode: string;
    zoomActive: boolean;
    zoomHUDScale: number;
    /** Small spinner; the seek bar carries the loading line when controls are up. */
    ripple: { show: boolean; side: 'left' | 'right'; seconds: number; x: number; y: number; at: number };
    paused: boolean;
    controlsVisible: boolean;
    topInset: number;
}

export const VideoHUD: React.FC<VideoHUDProps> = React.memo(({
    showBrightnessHUD, brightnessHUD, showVolumeHUD, volumeHUD, maxVolume = 1,
    showSpeedHUD, playbackRate, showResizeHUD, resizeMode, zoomActive, zoomHUDScale,
    ripple, paused, controlsVisible, topInset,
}) => {
    const { height } = useWindowDimensions();
    // ~12% down, but never under the top bar (portrait is short on top room).
    const slotTop = Math.max(height * 0.12, topInset + TOP_BAR + metrics.space.sm);
    const ResizeModeIcon = getResizeModeIcon(resizeMode);
    const showSpeed = showSpeedHUD && Math.abs(playbackRate - 1) > 0.01;

    // One slot, most hands-on first: brightness and volume never show together (usePlayerHUD).
    let status: React.ReactNode = null;
    if (showBrightnessHUD) {
        status = <Level value={brightnessHUD} kind="brightness" max={1} />;
    } else if (showVolumeHUD) {
        status = <Level value={volumeHUD} kind="volume" max={maxVolume} />;
    } else if (showSpeed) {
        status = (
            <>
                <Feather name={playbackRate > 1 ? 'fast-forward' : 'clock'} size={18} color={colors.text} />
                <Text maxFontSizeMultiplier={metrics.playerFontScale} style={styles.value}>{formatRate(playbackRate)}</Text>
            </>
        );
    } else if (zoomActive && zoomHUDScale > 1) {
        status = (
            <>
                <Feather name="maximize" size={18} color={colors.text} />
                <Text maxFontSizeMultiplier={metrics.playerFontScale} style={styles.value}>{formatRate(zoomHUDScale)}</Text>
            </>
        );
    } else if (showResizeHUD) {
        status = (
            <>
                <ResizeModeIcon size={18} color={colors.text} />
                <Text maxFontSizeMultiplier={metrics.playerFontScale} style={styles.label}>{getResizeModeLabel(resizeMode)}</Text>
            </>
        );
    }

    return (
        <>
            <DoubleTapRipple {...ripple} />
            <PlayPauseFlash paused={paused} controlsVisible={controlsVisible} />

            {status && <StatusPill top={slotTop}>{status}</StatusPill>}
        </>
    );
});

VideoHUD.displayName = 'VideoHUD';

const styles = StyleSheet.create({
    center: {
        ...StyleSheet.absoluteFill,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 8,
    },
    slot: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 11 },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.md,
        height: 40,
        paddingHorizontal: metrics.space.lg,
        borderRadius: metrics.radius.lg,
        backgroundColor: HUD_PILL,
    },
    track: { width: 120, height: 4, borderRadius: 2, overflow: 'hidden' },
    trackBg: { ...StyleSheet.absoluteFill, backgroundColor: colors.text, opacity: 0.25 },
    fill: { height: '100%', borderRadius: 2 },
    value: { ...type.label, color: colors.text, fontVariant: ['tabular-nums'], minWidth: 40, textAlign: 'right' },
    label: { ...type.label, color: colors.text },
});
