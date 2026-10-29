import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import Animated, {
    FadeIn,
    FadeOut,
    ReduceMotion,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withDelay,
    withSequence,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { metrics, motion, playerTheme, type } from '@/theme/theme';
import { HUD_PILL } from '@/theme/colors';

const { colors } = playerTheme;

const PULSE_RADIUS = 96;
const NUDGE = 6;
/** ponytail: hold between the flash's fade in and fade out; not a motion token. */
const FLASH_HOLD_MS = 250;
// Fades are information, not motion: they stay on with reduce motion.
const fadeIn = { duration: motion.fadeIn, reduceMotion: ReduceMotion.Never };
const fadeOut = { duration: motion.fadeOut, reduceMotion: ReduceMotion.Never };

interface DoubleTapRippleProps {
    show: boolean;
    side: 'left' | 'right';
    /** Accumulated seek, "20s". */
    seconds: number;
    /** Latest tap, window coordinates; `at` changes on every tap of the run. */
    x: number;
    y: number;
    at: number;
}

/** Touch-point pulse plus a side readout ("▸▸ 20s") that bumps on every tap of the run. */
export const DoubleTapRipple: React.FC<DoubleTapRippleProps> = React.memo(({ show, side, seconds, x, y, at }) => {
    const reduceMotion = useReducedMotion();
    const pulseScale = useSharedValue(0);
    const pulseOpacity = useSharedValue(0);
    const bump = useSharedValue(1);
    const nudge = useSharedValue(0);
    const runSide = useRef<'left' | 'right' | null>(null);

    useEffect(() => {
        const continuing = show && runSide.current === side;
        runSide.current = show ? side : null;
        if (!show || reduceMotion) {return;}
        pulseScale.value = 0;
        pulseOpacity.value = 0.22;
        pulseScale.value = withSpring(1, motion.spatial);
        pulseOpacity.value = withTiming(0, { duration: motion.fadeOut });
        // The pill fades in on the run's first tap; later taps bump the number and nudge the glyph.
        if (!continuing) {return;}
        bump.value = 1.12;
        bump.value = withSpring(1, motion.press);
        nudge.value = withSequence(
            withSpring(side === 'left' ? -NUDGE : NUDGE, motion.press),
            withSpring(0, motion.press),
        );
    }, [show, at, side, reduceMotion, pulseScale, pulseOpacity, bump, nudge]);

    const pulseStyle = useAnimatedStyle(() => ({
        opacity: pulseOpacity.value,
        transform: [{ scale: pulseScale.value }],
    }));
    const bumpStyle = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }));
    const nudgeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: nudge.value }] }));

    const left = side === 'left';
    return (
        <View style={styles.container} pointerEvents="none">
            <Animated.View style={[styles.pulse, { left: x - PULSE_RADIUS, top: y - PULSE_RADIUS }, pulseStyle]} />
            {show && (
                <Animated.View
                    key={side}
                    style={[styles.half, left ? styles.leftHalf : styles.rightHalf]}
                    entering={FadeIn.duration(motion.fadeIn).reduceMotion(ReduceMotion.Never)}
                    exiting={FadeOut.duration(motion.fadeOut).reduceMotion(ReduceMotion.Never)}
                >
                    <View style={styles.readout}>
                        <Animated.View style={nudgeStyle}>
                            <Feather name={left ? 'rewind' : 'fast-forward'} size={20} color={colors.text} />
                        </Animated.View>
                        <Animated.Text style={[styles.readoutText, bumpStyle]}>{`${seconds}s`}</Animated.Text>
                    </View>
                </Animated.View>
            )}
        </View>
    );
});

DoubleTapRipple.displayName = 'DoubleTapRipple';

interface PlayPauseFlashProps {
    paused: boolean;
    /** Only flash when nothing else shows the play state. */
    controlsVisible: boolean;
}

/** Centre glyph when play state changes with controls hidden (centre double tap, media keys). */
export const PlayPauseFlash: React.FC<PlayPauseFlashProps> = React.memo(({ paused, controlsVisible }) => {
    const reduceMotion = useReducedMotion();
    const opacity = useSharedValue(0);
    const scale = useSharedValue(1);
    const prevPaused = useRef(paused);

    useEffect(() => {
        if (prevPaused.current === paused) {return;}
        prevPaused.current = paused;
        if (controlsVisible) {return;}
        opacity.value = withSequence(withTiming(1, fadeIn), withDelay(FLASH_HOLD_MS, withTiming(0, fadeOut)));
        if (!reduceMotion) {
            scale.value = 0.85;
            scale.value = withSpring(1, motion.press);
        }
    }, [paused, controlsVisible, reduceMotion, opacity, scale]);

    const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));

    return (
        <View style={styles.flashWrap} pointerEvents="none">
            <Animated.View style={[styles.flash, style]}>
                <Feather name={paused ? 'pause' : 'play'} size={34} color={colors.text} />
            </Animated.View>
        </View>
    );
});

PlayPauseFlash.displayName = 'PlayPauseFlash';

const styles = StyleSheet.create({
    container: { ...StyleSheet.absoluteFill, zIndex: 9, overflow: 'hidden' },
    pulse: {
        position: 'absolute',
        width: PULSE_RADIUS * 2,
        height: PULSE_RADIUS * 2,
        borderRadius: PULSE_RADIUS,
        backgroundColor: colors.text,
    },
    half: { position: 'absolute', top: 0, bottom: 0, width: '50%', alignItems: 'center', justifyContent: 'center' },
    leftHalf: { left: 0 },
    rightHalf: { right: 0 },
    readout: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.sm,
        paddingHorizontal: metrics.space.lg,
        paddingVertical: metrics.space.sm,
        borderRadius: metrics.radius.card,
        backgroundColor: HUD_PILL,
    },
    readoutText: { ...type.readout, fontSize: 20, color: colors.text, minWidth: 40 },
    flashWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', zIndex: 9 },
    flash: {
        width: 72,
        height: 72,
        borderRadius: 36,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: HUD_PILL,
        opacity: 0,
    },
});
