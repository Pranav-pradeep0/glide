import React, { useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, {
    Rect,
    Path,
    Line,
    Circle,
    G,
} from 'react-native-svg';
import Animated, {
    useSharedValue,
    useAnimatedProps,
    withTiming,
    withSequence,
    Easing,
} from 'react-native-reanimated';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedG = Animated.createAnimatedComponent(G);

// ─── Dimensions ────────────────────────────────
const FRAME_W = 340;
const FRAME_H = 200;

// Phone rectangle (landscape)
const PHONE_X = 20;
const PHONE_Y = 10;
const PHONE_W = 300;
const PHONE_H = 160;
const PHONE_R = 14;
const PHONE_CX = PHONE_X + PHONE_W / 2;
const PHONE_CY = PHONE_Y + PHONE_H / 2;

// Subtitle area — near bottom of phone screen
const SUB_Y1 = PHONE_Y + PHONE_H - 28;
const SUB_Y2 = PHONE_Y + PHONE_H - 14;
const SUB_CX = PHONE_CX;

const leftTapX = PHONE_X + PHONE_W * 0.25;
const rightTapX = PHONE_X + PHONE_W * 0.75;

interface PlaybackIconProps {
    animate: boolean;
    color: string;
}

export default function PlaybackIcon({
    animate,
    color,
}: PlaybackIconProps) {
    const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    // ─── Shared values ─────────────────────────

    const playOpacity = useSharedValue(0);
    const isPause = useSharedValue(0);

    const subLine1Width = useSharedValue(0);
    const subLine2Width = useSharedValue(0);
    const subOpacity = useSharedValue(0);
    const subYOffset = useSharedValue(0); // moves subtitles up/down during gesture

    const gestureRippleOpacity = useSharedValue(0);
    const gestureRippleScale = useSharedValue(0.3);
    const gestureRippleY = useSharedValue(PHONE_Y + PHONE_H - 40);

    const tapLeftOpacity = useSharedValue(0);
    const tapLeftScale = useSharedValue(0.3);
    const tapRightOpacity = useSharedValue(0);
    const tapRightScale = useSharedValue(0.3);
    const arrowLeftOpacity = useSharedValue(0);
    const arrowRightOpacity = useSharedValue(0);

    // Helper to schedule a timer and track it for cleanup
    const schedule = useCallback((fn: () => void, delay: number) => {
        const id = setTimeout(fn, delay);
        timersRef.current.push(id);
    }, []);

    const resetAll = useCallback(() => {
        'worklet';
        playOpacity.value = 0;
        isPause.value = 0;
        subLine1Width.value = 0;
        subLine2Width.value = 0;
        subOpacity.value = 0;
        subYOffset.value = 0;
        gestureRippleOpacity.value = 0;
        gestureRippleScale.value = 0.3;
        gestureRippleY.value = PHONE_Y + PHONE_H - 40;
        tapLeftOpacity.value = 0;
        tapLeftScale.value = 0.3;
        tapRightOpacity.value = 0;
        tapRightScale.value = 0.3;
        arrowLeftOpacity.value = 0;
        arrowRightOpacity.value = 0;
    }, []);

    const runAnimation = useCallback(() => {
        // Clear any pending timers from previous cycle
        timersRef.current.forEach(id => clearTimeout(id));
        timersRef.current = [];

        resetAll();

        let t = 0;

        // ─── Phase 1: Play → hold → Pause → hold → fade out ─────
        // Play triangle fades in
        schedule(() => {
            playOpacity.value = withTiming(1, { duration: 400 });
        }, t);
        t += 400;

        // Hold play for 800ms, then morph to pause
        schedule(() => {
            isPause.value = withTiming(1, { duration: 300 });
        }, t + 800);
        t += 800 + 300;

        // Hold pause for 600ms, then fade out
        schedule(() => {
            playOpacity.value = withTiming(0, { duration: 400 });
        }, t + 600);
        t += 600 + 400;

        // ─── Phase 2: Subtitle lines cycling (3 cycles) ─────
        // Subtitles fade in
        schedule(() => {
            subOpacity.value = withTiming(1, { duration: 250 });
            subLine1Width.value = withTiming(90, { duration: 350 });
            subLine2Width.value = withTiming(55, { duration: 350 });
        }, t);
        t += 700;

        // Cycle 2 — swap lengths
        schedule(() => {
            subLine1Width.value = withTiming(60, { duration: 300 });
            subLine2Width.value = withTiming(100, { duration: 300 });
        }, t);
        t += 700;

        // Cycle 3
        schedule(() => {
            subLine1Width.value = withTiming(110, { duration: 300 });
            subLine2Width.value = withTiming(45, { duration: 300 });
        }, t);
        t += 700;

        // Don't fade out subtitles — keep them for gesture phase
        // Just set to a stable width
        schedule(() => {
            subLine1Width.value = withTiming(80, { duration: 300 });
            subLine2Width.value = withTiming(60, { duration: 300 });
        }, t);
        t += 400;

        // ─── Phase 3: Vertical gesture swipe (moves subtitles) ─────
        schedule(() => {
            gestureRippleY.value = PHONE_Y + PHONE_H - 40;
            gestureRippleOpacity.value = withTiming(0.3, { duration: 200 });
            gestureRippleScale.value = withTiming(1, { duration: 200 });
        }, t);

        // Slide up — subtitles move up
        schedule(() => {
            gestureRippleY.value = withTiming(PHONE_Y + 28, {
                duration: 600,
                easing: Easing.inOut(Easing.cubic),
            });
            subYOffset.value = withTiming(-30, {
                duration: 600,
                easing: Easing.inOut(Easing.cubic),
            });
        }, t + 250);

        // Slide back down — subtitles move down
        schedule(() => {
            gestureRippleY.value = withTiming(PHONE_Y + PHONE_H - 28, {
                duration: 600,
                easing: Easing.inOut(Easing.cubic),
            });
            subYOffset.value = withTiming(10, {
                duration: 600,
                easing: Easing.inOut(Easing.cubic),
            });
        }, t + 900);

        // Reset subtitles position and fade out ripple
        schedule(() => {
            gestureRippleOpacity.value = withTiming(0, { duration: 250 });
            gestureRippleScale.value = withTiming(0.3, { duration: 250 });
            subYOffset.value = withTiming(0, { duration: 300 });
        }, t + 1550);

        // Fade out subtitles after gesture
        schedule(() => {
            subOpacity.value = withTiming(0, { duration: 300 });
            subLine1Width.value = withTiming(0, { duration: 300 });
            subLine2Width.value = withTiming(0, { duration: 300 });
        }, t + 1850);
        t += 2200;

        // ─── Phase 4: Double-tap left (seek back) ─────
        // First tap
        schedule(() => {
            tapLeftOpacity.value = withSequence(
                withTiming(0.35, { duration: 80 }),
                withTiming(0, { duration: 350 }),
            );
            tapLeftScale.value = withSequence(
                withTiming(1, { duration: 80 }),
                withTiming(1.6, { duration: 350 }),
            );
        }, t);

        // Second tap (double tap) + arrows
        schedule(() => {
            tapLeftOpacity.value = withSequence(
                withTiming(0.35, { duration: 80 }),
                withTiming(0, { duration: 350 }),
            );
            tapLeftScale.value = withSequence(
                withTiming(1, { duration: 80 }),
                withTiming(1.6, { duration: 350 }),
            );
            arrowLeftOpacity.value = withSequence(
                withTiming(1, { duration: 100 }),
                withTiming(1, { duration: 350 }),
                withTiming(0, { duration: 200 }),
            );
        }, t + 200);
        t += 900;

        // ─── Double-tap right (seek forward) ─────
        // First tap
        schedule(() => {
            tapRightOpacity.value = withSequence(
                withTiming(0.35, { duration: 80 }),
                withTiming(0, { duration: 350 }),
            );
            tapRightScale.value = withSequence(
                withTiming(1, { duration: 80 }),
                withTiming(1.6, { duration: 350 }),
            );
        }, t);

        // Second tap + arrows
        schedule(() => {
            tapRightOpacity.value = withSequence(
                withTiming(0.35, { duration: 80 }),
                withTiming(0, { duration: 350 }),
            );
            tapRightScale.value = withSequence(
                withTiming(1, { duration: 80 }),
                withTiming(1.6, { duration: 350 }),
            );
            arrowRightOpacity.value = withSequence(
                withTiming(1, { duration: 100 }),
                withTiming(1, { duration: 350 }),
                withTiming(0, { duration: 200 }),
            );
        }, t + 200);
        t += 900;

        // ─── Loop: reset and restart after a pause ─────
        schedule(() => {
            resetAll();
        }, t + 600);

        schedule(() => {
            runAnimation();
        }, t + 900);
    }, [resetAll, schedule]);

    useEffect(() => {
        if (animate) {
            runAnimation();
        }
        return () => {
            timersRef.current.forEach(id => clearTimeout(id));
            timersRef.current = [];
        };
    }, [animate, runAnimation]);

    // ─── Animated Props ────────────────────────────

    // Play / Pause
    const playTrianglePath = `M${PHONE_CX - 14} ${PHONE_CY - 18} L${PHONE_CX + 18} ${PHONE_CY} L${PHONE_CX - 14} ${PHONE_CY + 18} Z`;
    const pauseLeftPath = `M${PHONE_CX - 12} ${PHONE_CY - 16} L${PHONE_CX - 12} ${PHONE_CY + 16}`;
    const pauseRightPath = `M${PHONE_CX + 8} ${PHONE_CY - 16} L${PHONE_CX + 8} ${PHONE_CY + 16}`;

    const playProps = useAnimatedProps(() => ({
        opacity: playOpacity.value * (1 - isPause.value),
    }));
    const pauseLeftProps = useAnimatedProps(() => ({
        opacity: playOpacity.value * isPause.value,
    }));
    const pauseRightProps = useAnimatedProps(() => ({
        opacity: playOpacity.value * isPause.value,
    }));

    // Subtitle lines (with vertical offset for gesture phase)
    const sub1Props = useAnimatedProps(() => ({
        x1: SUB_CX - subLine1Width.value / 2,
        x2: SUB_CX + subLine1Width.value / 2,
        y1: SUB_Y1 + subYOffset.value,
        y2: SUB_Y1 + subYOffset.value,
        opacity: subOpacity.value,
    }));
    const sub2Props = useAnimatedProps(() => ({
        x1: SUB_CX - subLine2Width.value / 2,
        x2: SUB_CX + subLine2Width.value / 2,
        y1: SUB_Y2 + subYOffset.value,
        y2: SUB_Y2 + subYOffset.value,
        opacity: subOpacity.value,
    }));

    // Gesture ripple
    const gestureRippleProps = useAnimatedProps(() => ({
        cy: gestureRippleY.value,
        opacity: gestureRippleOpacity.value,
        r: 18 * gestureRippleScale.value,
    }));

    // Double-tap ripples
    const tapLeftRippleProps = useAnimatedProps(() => ({
        opacity: tapLeftOpacity.value,
        r: 22 * tapLeftScale.value,
    }));
    const tapRightRippleProps = useAnimatedProps(() => ({
        opacity: tapRightOpacity.value,
        r: 22 * tapRightScale.value,
    }));

    // Arrow opacities
    const arrowLeftProps = useAnimatedProps(() => ({
        opacity: arrowLeftOpacity.value,
    }));
    const arrowRightProps = useAnimatedProps(() => ({
        opacity: arrowRightOpacity.value,
    }));

    return (
        <View style={styles.container}>
            <Svg width={FRAME_W} height={FRAME_H} viewBox={`0 0 ${FRAME_W} ${FRAME_H}`}>
                {/* ── Phone rectangle (static) ── */}
                <Rect
                    x={PHONE_X}
                    y={PHONE_Y}
                    width={PHONE_W}
                    height={PHONE_H}
                    rx={PHONE_R}
                    ry={PHONE_R}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                />



                {/* ── Play triangle ─────────────── */}
                <AnimatedPath
                    d={playTrianglePath}
                    fill={color}
                    animatedProps={playProps}
                />

                {/* ── Pause bars ────────────────── */}
                <AnimatedPath
                    d={pauseLeftPath}
                    stroke={color}
                    strokeWidth={6}
                    strokeLinecap="round"
                    fill="none"
                    animatedProps={pauseLeftProps}
                />
                <AnimatedPath
                    d={pauseRightPath}
                    stroke={color}
                    strokeWidth={6}
                    strokeLinecap="round"
                    fill="none"
                    animatedProps={pauseRightProps}
                />

                {/* ── Subtitle line 1 ──────────── */}
                <AnimatedLine
                    stroke={color}
                    strokeWidth={3}
                    strokeLinecap="round"
                    animatedProps={sub1Props}
                />
                {/* ── Subtitle line 2 ──────────── */}
                <AnimatedLine
                    stroke={color}
                    strokeWidth={3}
                    strokeLinecap="round"
                    animatedProps={sub2Props}
                />

                {/* ── Gesture ripple (vertical swipe) ── */}
                <AnimatedCircle
                    cx={PHONE_CX}
                    fill={color}
                    animatedProps={gestureRippleProps}
                />

                {/* ── Double-tap left ripple ────── */}
                <AnimatedCircle
                    cx={leftTapX}
                    cy={PHONE_CY}
                    fill={color}
                    animatedProps={tapLeftRippleProps}
                />

                {/* ── Left seek arrows (<<) ─────── */}
                <AnimatedG animatedProps={arrowLeftProps}>
                    <Path
                        d={`M${leftTapX + 2} ${PHONE_CY - 8} L${leftTapX - 8} ${PHONE_CY} L${leftTapX + 2} ${PHONE_CY + 8}`}
                        stroke={color}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                    />
                    <Path
                        d={`M${leftTapX + 12} ${PHONE_CY - 8} L${leftTapX + 2} ${PHONE_CY} L${leftTapX + 12} ${PHONE_CY + 8}`}
                        stroke={color}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                    />
                </AnimatedG>

                {/* ── Double-tap right ripple ───── */}
                <AnimatedCircle
                    cx={rightTapX}
                    cy={PHONE_CY}
                    fill={color}
                    animatedProps={tapRightRippleProps}
                />

                {/* ── Right seek arrows (>>) ────── */}
                <AnimatedG animatedProps={arrowRightProps}>
                    <Path
                        d={`M${rightTapX - 2} ${PHONE_CY - 8} L${rightTapX + 8} ${PHONE_CY} L${rightTapX - 2} ${PHONE_CY + 8}`}
                        stroke={color}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                    />
                    <Path
                        d={`M${rightTapX - 12} ${PHONE_CY - 8} L${rightTapX - 2} ${PHONE_CY} L${rightTapX - 12} ${PHONE_CY + 8}`}
                        stroke={color}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                    />
                </AnimatedG>
            </Svg>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
        width: FRAME_W,
        height: FRAME_H,
    },
});
