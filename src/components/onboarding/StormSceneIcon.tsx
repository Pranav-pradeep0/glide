import React, { useEffect, useRef, useCallback } from 'react';
import { Text, StyleSheet } from 'react-native';
import Svg, {
    Rect, Path, Circle, G, Defs,
    LinearGradient, Stop, ClipPath,
} from 'react-native-svg';
import Animated, {
    useSharedValue, useAnimatedProps, useAnimatedStyle,
    withTiming, withSequence, withRepeat,
    Easing, cancelAnimation, interpolate,
} from 'react-native-reanimated';
import { SUBTITLE_FONT_FAMILY } from '@/store/appStore';

// ─── Animated SVG primitives ──────────────────────────────────────────────────
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);

// ─── Layout constants ─────────────────────────────────────────────────────────
const W = 340;
const H = 200;
const SX = 20;    // scene left
const SY = 10;    // scene top
const SW = 300;   // scene width
const SH = 160;   // scene height
const SR = 14;    // corner radius
const HZ = SY + 88; // horizon Y = 98

// ─── Moon constants ───────────────────────────────────────────────────────────
const MX = SX + 222; // moon center X = 242
const MY = SY + 33;  // moon center Y = 43
const MR = 13;       // moon radius

// ─── Seeded pseudo-random ─────────────────────────────────────────────────────
function hr(n: number): number {
    const x = Math.sin(n) * 10000;
    return x - Math.floor(x);
}

// ─── Stars ────────────────────────────────────────────────────────────────────
function buildStars(count: number): string {
    let d = '';
    for (let i = 0; i < count; i++) {
        // Spread stars in the upper sky area, avoiding moon vicinity
        const x = SX + 6 + hr(i * 23.1 + 7) * (SW - 12);
        const y = SY + 3 + hr(i * 31.7 + 13) * (HZ - SY - 55) * 0.72;
        const s = 0.45 + hr(i * 11.3 + 5) * 1.0; // varied star size
        d += `M ${x.toFixed(1)} ${(y - s).toFixed(1)} l 0 ${(s * 2).toFixed(1)} `;
        d += `M ${(x - s).toFixed(1)} ${y.toFixed(1)} l ${(s * 2).toFixed(1)} 0 `;
    }
    return d;
}
const STARS = buildStars(22);

// ─── Crescent moon path ───────────────────────────────────────────────────────
// Two equal-radius circles offset horizontally. Their intersections are the
// crescent's horns. The crescent path = outer large CCW arc + inner SMALL CW arc.
//
// CRITICAL: inner arc must use large-arc=0 (small arc).
// If both arcs are "large" with the same radius and endpoints they trace the
// SAME arc in opposite directions → closes into a full circle (the original bug).
// The small arc on the inner circle stays on the same side as its center
// (right of the chord) = the concave terminator bite.
//
// MOON_OFFSET > 0  →  inner circle shifted right  →  crescent opens left  (☽)
const MOON_OFFSET = 9;  // bigger offset = thinner crescent
const _mx2 = MOON_OFFSET / 2;
const _my2 = Math.sqrt(MR * MR - _mx2 * _mx2);
const MOON_TX = (MX + _mx2).toFixed(2);  // horn X (both horns share same X)
const MOON_TY = (MY - _my2).toFixed(2);  // top horn Y
const MOON_BY = (MY + _my2).toFixed(2);  // bottom horn Y
//   Outer arc : large (1), CCW sweep (0) → big left-side bulge (lit face)
//   Inner arc : small (0), CW  sweep (1) → small right-side bite (terminator)
const MOON_PATH =
    `M ${MOON_TX} ${MOON_TY} ` +
    `A ${MR} ${MR} 0 1 0 ${MOON_TX} ${MOON_BY} ` +
    `A ${MR} ${MR} 0 0 1 ${MOON_TX} ${MOON_TY} Z`;



// ─── Lightning bolt paths ─────────────────────────────────────────────────────
// Envelope sin() tapers displacement to zero at top and bottom for natural look
function genLg(seed: number): string {
    const sx = SX + 52 + seed * 178;
    const ey = HZ - 16;
    let d = `M ${sx.toFixed(1)} ${(SY + 7).toFixed(1)}`;
    let cx = sx;
    const segs = 9;
    for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const cy = SY + 7 + t * (ey - SY - 7);
        // displacement envelope: peaks in upper-middle, tapers at ends
        const env = Math.sin(Math.PI * t * 0.85 + 0.1);
        const zz = Math.sin(seed * 310 + i * 13.7) * 17 * env;
        cx = sx + zz;
        d += ` L ${cx.toFixed(1)} ${cy.toFixed(1)}`;
    }
    return d;
}
const LG_PATHS = [0.10, 0.52, 0.90].map(genLg);
function genBranch(seed: number, dir: 1 | -1): string {
    const sx = SX + 52 + seed * 178;
    return `M ${(sx + 2).toFixed(1)} ${(SY + 48).toFixed(1)} L ${(sx + dir * 20).toFixed(1)} ${(SY + 66).toFixed(1)} L ${(sx + dir * 12).toFixed(1)} ${(SY + 82).toFixed(1)}`;
}
const BR_PATHS = [
    genBranch(0.10, 1),
    genBranch(0.52, -1),
    genBranch(0.90, 1),
];

// ─── Wave paths ───────────────────────────────────────────────────────────────
// Asymmetric cycloid shape: compressed crest (steep) + wide trough (flat)
// This matches real deep-water storm waves more closely than sinusoids
const WAVE_PERIOD = 96; // Exact repeat width for seamless horizontal looping
const WAVE_CYCLES = 12; // Long overdraw so clipping never exposes path ends

function makeWave(baseY: number, amp: number): string {
    const startX = SX - WAVE_PERIOD * 2;
    let d = `M ${startX.toFixed(1)} ${baseY.toFixed(1)}`;
    for (let i = 0; i < WAVE_CYCLES; i++) {
        const x = startX + i * WAVE_PERIOD;
        const q1x = x + WAVE_PERIOD * 0.25;
        const q2x = x + WAVE_PERIOD * 0.75;
        const midX = x + WAVE_PERIOD * 0.5;
        const endX = x + WAVE_PERIOD;
        d += ` Q ${q1x.toFixed(1)} ${(baseY - amp).toFixed(1)} ${midX.toFixed(1)} ${baseY.toFixed(1)}`;
        d += ` Q ${q2x.toFixed(1)} ${(baseY + amp).toFixed(1)} ${endX.toFixed(1)} ${baseY.toFixed(1)}`;
    }
    return d;
}
const WAVE1 = makeWave(HZ + 5, 2.8);   // horizon glimmer
const WAVE2 = makeWave(HZ + 17, 5.0);  // mid swell
const WAVE3 = makeWave(HZ + 31, 7.2);  // large swell
const WAVE4 = makeWave(HZ + 49, 4.2);  // foreground trough

// ─── Rain ─────────────────────────────────────────────────────────────────────
const TILE_H = SH + 40;

function buildRain(count: number, seed: number, minL: number, maxL: number, deg: number): string {
    const rdx = Math.sin((deg * Math.PI) / 180);
    const rdy = Math.cos((deg * Math.PI) / 180);
    let d = '';
    for (let i = 0; i < count; i++) {
        const x = SX + hr(i * 17.1 + seed) * SW;
        const y = SY - 12 + hr(i * 29.4 + seed + 1) * TILE_H;
        const l = minL + hr(i * 43.7 + seed + 2) * (maxL - minL);
        d += `M ${x.toFixed(1)} ${y.toFixed(1)} L ${(x + rdx * l).toFixed(1)} ${(y + rdy * l).toFixed(1)} `;
    }
    return d;
}
// Two layers: heavy angled rain + lighter near-vertical fine mist
const RAIN_HEAVY = buildRain(20, 0, 9, 21, 12);
const RAIN_MIST = buildRain(14, 99, 4, 10, 5);

// ─── Horizon sea spray ────────────────────────────────────────────────────────
// Short horizontal dashes just above/at the waterline — foam & spray detail
function buildSpray(): string {
    let d = '';
    for (let i = 0; i < 18; i++) {
        const x = SX + 6 + hr(i * 19.3 + 50) * (SW - 12);
        const y = HZ + 2 + hr(i * 13.7 + 51) * 13;
        const len = 2.5 + hr(i * 7.1 + 52) * 10;
        d += `M ${x.toFixed(1)} ${y.toFixed(1)} l ${len.toFixed(1)} 0 `;
    }
    return d;
}
const HORIZON_SPRAY = buildSpray();

// ─── Ship geometry (unchanged, verified correct) ─────────────────────────────
const SHX = SX + 64;
const SHY = HZ - 8;
const HULL = `M ${SHX - 18} ${SHY + 9} L ${SHX + 40} ${SHY + 9} Q ${SHX + 47} ${SHY + 10} ${SHX + 44} ${SHY + 15} L ${SHX - 12} ${SHY + 15} Q ${SHX - 22} ${SHY + 13} ${SHX - 18} ${SHY + 9} Z`;
const CABIN = `M ${SHX + 4} ${SHY + 9} L ${SHX + 4} ${SHY + 3} Q ${SHX + 6} ${SHY + 1} ${SHX + 10} ${SHY + 1} L ${SHX + 26} ${SHY + 1} Q ${SHX + 28} ${SHY + 1} ${SHX + 28} ${SHY + 4} L ${SHX + 28} ${SHY + 9} Z`;
const FUNNEL = `M ${SHX + 20} ${SHY + 2} L ${SHX + 19} ${SHY - 5} L ${SHX + 25} ${SHY - 5} L ${SHX + 24} ${SHY + 2} Z`;
const MAST = `M ${SHX + 13} ${SHY + 1} L ${SHX + 13} ${SHY - 16}`;
const BOW = `M ${SHX - 18} ${SHY + 9} L ${SHX - 26} ${SHY + 14}`;

// ─── Public props ─────────────────────────────────────────────────────────────
interface StormSceneIconProps {
    animate: boolean;
    vivid: boolean;
    color?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────
function StormSceneAnimatedIcon({
    animate,
    vivid,
    color,
}: StormSceneIconProps) {

    const alive = useRef(false);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);


    // ── Shared values ────────────────────────────────────────────────────────
    const sat = useSharedValue(vivid ? 1 : 0);
    const waveX = useSharedValue(0);
    const wavePhase = useSharedValue(0);
    const shipY = useSharedValue(0);
    const rainY = useSharedValue(0);
    const lgOp1 = useSharedValue(0);
    const lgOp2 = useSharedValue(0);
    const lgOp3 = useSharedValue(0);
    const brOp1 = useSharedValue(0);
    const brOp2 = useSharedValue(0);
    const brOp3 = useSharedValue(0);
    const lgFlash = useSharedValue(0);
    const subtitleOp = useSharedValue(0);
    const shakeX = useSharedValue(0);
    const shakeY = useSharedValue(0);

    useEffect(() => { sat.value = withTiming(vivid ? 1 : 0, { duration: 700 }); }, [vivid]);

    const showSubtitle = useCallback(() => {
        cancelAnimation(subtitleOp);
        subtitleOp.value = 0;
        subtitleOp.value = withSequence(
            withTiming(1, { duration: 90 }),
            withTiming(1, { duration: 520 }),
            withTiming(0, { duration: 260 }),
        );
    }, []);

    const after = useCallback((fn: () => void, ms: number) => {
        const id = setTimeout(fn, ms);
        timers.current.push(id);
        return id;
    }, []);

    const strike = useCallback(() => {
        const lane = Math.floor(Math.random() * 3);
        const lgV = lane === 0 ? lgOp1 : lane === 1 ? lgOp2 : lgOp3;
        const brV = lane === 0 ? brOp1 : lane === 1 ? brOp2 : brOp3;

        lgV.value = withSequence(
            withTiming(1, { duration: 30 }),
            withTiming(0.24, { duration: 42 }),
            withTiming(0.92, { duration: 24 }),
            withTiming(0.34, { duration: 58 }),
            withTiming(0.78, { duration: 26 }),
            withTiming(0, { duration: 210 }),
        );
        brV.value = withSequence(
            withTiming(0, { duration: 36 }),
            withTiming(0.82, { duration: 28 }),
            withTiming(0.18, { duration: 42 }),
            withTiming(0.64, { duration: 24 }),
            withTiming(0, { duration: 150 }),
        );
        lgFlash.value = withSequence(
            withTiming(0.42, { duration: 34 }),
            withTiming(0.10, { duration: 52 }),
            withTiming(0.24, { duration: 28 }),
            withTiming(0, { duration: 190 }),
        );

        // Thunder rumble — rapid dual-axis micro-oscillations that decay
        shakeX.value = withSequence(
            withTiming(1.8, { duration: 25 }),
            withTiming(-1.5, { duration: 25 }),
            withTiming(1.6, { duration: 25 }),
            withTiming(-1.3, { duration: 25 }),
            withTiming(1.1, { duration: 25 }),
            withTiming(-0.9, { duration: 30 }),
            withTiming(0.7, { duration: 30 }),
            withTiming(-0.5, { duration: 30 }),
            withTiming(0.3, { duration: 35 }),
            withTiming(-0.2, { duration: 35 }),
            withTiming(0, { duration: 40 }),
        );
        shakeY.value = withSequence(
            withTiming(-1.2, { duration: 25 }),
            withTiming(1.0, { duration: 25 }),
            withTiming(-1.1, { duration: 25 }),
            withTiming(0.8, { duration: 25 }),
            withTiming(-0.7, { duration: 25 }),
            withTiming(0.5, { duration: 30 }),
            withTiming(-0.4, { duration: 30 }),
            withTiming(0.3, { duration: 30 }),
            withTiming(-0.2, { duration: 35 }),
            withTiming(0.1, { duration: 35 }),
            withTiming(0, { duration: 40 }),
        );

        showSubtitle();
    }, [showSubtitle, after]);

    useEffect(() => {
        alive.current = animate;

        const cancelAll = () => {
            timers.current.forEach(clearTimeout);
            timers.current = [];
            cancelAnimation(waveX);
            cancelAnimation(wavePhase);
            cancelAnimation(shipY);
            cancelAnimation(rainY);
            cancelAnimation(lgOp1);
            cancelAnimation(lgOp2);
            cancelAnimation(lgOp3);
            cancelAnimation(brOp1);
            cancelAnimation(brOp2);
            cancelAnimation(brOp3);
            cancelAnimation(lgFlash);
            cancelAnimation(subtitleOp);
            cancelAnimation(shakeX);
            cancelAnimation(shakeY);
        };

        if (!animate) {
            cancelAll();
            subtitleOp.value = withTiming(0, { duration: 250 });
            return;
        }

        // Reset all values before re-starting to prevent rain-slowdown bug
        // (withRepeat snapshots current value as new origin on restart)
        waveX.value = 0;
        wavePhase.value = 0;
        shipY.value = 0;
        rainY.value = 0;

        waveX.value = withRepeat(
            withTiming(WAVE_PERIOD, { duration: 2600, easing: Easing.linear }),
            -1, false,
        );
        wavePhase.value = withRepeat(
            withTiming(Math.PI * 2, { duration: 2400, easing: Easing.linear }),
            -1, false,
        );
        shipY.value = withRepeat(
            withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
            -1, true,
        );
        rainY.value = withRepeat(
            withTiming(TILE_H, { duration: 920, easing: Easing.linear }),
            -1, false,
        );

        // Staggered initial strikes for dramatic entry
        after(strike, 1900);
        after(strike, 4700);

        const loop = () => {
            if (!alive.current) {return;}
            strike();
            if (Math.random() < 0.40) { after(strike, 100 + Math.random() * 220); }
            after(loop, 5200 + Math.random() * 1600);
        };
        after(loop, 9200);

        return () => {
            alive.current = false;
            cancelAll();
        };
    }, [animate]);

    // ── Animated props ────────────────────────────────────────────────────────

    // Lightning lanes — OPTIMIZED: single opacity value per lane (reduced from 3 per lane)
    const lgP1 = useAnimatedProps(() => {
        'worklet';
        return { opacity: lgOp1.value };
    });
    const lgP2 = useAnimatedProps(() => {
        'worklet';
        return { opacity: lgOp2.value };
    });
    const lgP3 = useAnimatedProps(() => {
        'worklet';
        return { opacity: lgOp3.value };
    });
    const brP1 = useAnimatedProps(() => {
        'worklet';
        return { opacity: brOp1.value };
    });
    const brP2 = useAnimatedProps(() => {
        'worklet';
        return { opacity: brOp2.value };
    });
    const brP3 = useAnimatedProps(() => {
        'worklet';
        return { opacity: brOp3.value };
    });
    const lgFlshP = useAnimatedProps(() => {
        'worklet';
        return { opacity: lgFlash.value };
    });

    // Four wave layers — all derived from single waveX shared value (no extra values)
    // Different speed multipliers create convincing parallax
    // OPTIMIZED: Using worklets for UI thread execution
    const w1P = useAnimatedProps(() => {
        'worklet';
        return {
            transform: [
                { translateX: -waveX.value },
                { translateY: Math.sin(wavePhase.value + 0.4) * 0.7 },
            ],
        };
    });
    const w2P = useAnimatedProps(() => {
        'worklet';
        return {
            transform: [
                { translateX: -(waveX.value + 18) },
                { translateY: Math.sin(wavePhase.value + 1.2) * 1.1 },
            ],
        };
    });
    const w3P = useAnimatedProps(() => {
        'worklet';
        return {
            transform: [
                { translateX: -(waveX.value + 32) },
                { translateY: Math.sin(wavePhase.value + 2.0) * 1.5 },
            ],
        };
    });
    const w4P = useAnimatedProps(() => {
        'worklet';
        return {
            transform: [
                { translateX: -(waveX.value + 8) },
                { translateY: Math.sin(wavePhase.value + 2.8) * 0.9 },
            ],
        };
    });

    // Ship bob — smooth sinusoidal heave
    const shipP = useAnimatedProps(() => {
        'worklet';
        const translateY = Math.sin(shipY.value * Math.PI) * 2.8;
        return { transform: [{ translateY }] };
    });

    // Rain — two seamless tiles per layer for continuous scroll
    // OPTIMIZED: Using worklets for UI thread execution
    const rainAP = useAnimatedProps(() => {
        'worklet';
        return { transform: [{ translateY: rainY.value % TILE_H }] };
    });
    const rainBP = useAnimatedProps(() => {
        'worklet';
        return { transform: [{ translateY: (rainY.value % TILE_H) - TILE_H }] };
    });
    const rainMAP = useAnimatedProps(() => {
        'worklet';
        return { transform: [{ translateY: (rainY.value * 0.72) % TILE_H }] };
    });
    const rainMBP = useAnimatedProps(() => {
        'worklet';
        return { transform: [{ translateY: ((rainY.value * 0.72) % TILE_H) - TILE_H }] };
    });

    // Stars — brighter in vivid mode
    const starsP = useAnimatedProps(() => {
        'worklet';
        return { opacity: interpolate(sat.value, [0, 1], [0.38, 0.60]) };
    });

    // Moon opacity — bare crescent, no glow circles
    const moonP = useAnimatedProps(() => {
        'worklet';
        return { opacity: interpolate(sat.value, [0, 1], [0.80, 0.96]) };
    });

    // Subtitle — native Animated.View
    // OPTIMIZED: Using worklet for UI thread execution
    const subtitleStyle = useAnimatedStyle(() => {
        'worklet';
        return { opacity: subtitleOp.value };
    });

    // Screen rumble — rapid dual-axis tremor on lightning
    const shakeStyle = useAnimatedStyle(() => {
        'worklet';
        return { transform: [{ translateX: shakeX.value }, { translateY: shakeY.value }] };
    });

    // ── Color palette ─────────────────────────────────────────────────────────
    // Normal: deep midnight navy.  Vivid: near-black indigo with electric accents.
    const skyTop = vivid ? '#060810' : '#09131E';
    const skyMid = vivid ? '#0B0E22' : '#111D2C';
    const skyBot = vivid ? '#101530' : '#182838';
    const lgOuter = vivid ? '#7220E0' : '#5510B8';  // lightning corona
    const lgMid = vivid ? '#44E0FF' : '#28B8E8';  // lightning channel
    const lgCore = vivid ? '#ECFCFF' : '#D9F6FF'; // hottest lightning core
    const oceanBase = vivid ? '#040A14' : '#070E1A';
    const w1Col = vivid ? '#1A80A0' : '#146878';  // horizon glimmer
    const w2Col = vivid ? '#2090B8' : '#1A7888';  // mid swell
    const w3Col = vivid ? '#28A8D0' : '#1E8898';  // large swell
    const w4Col = vivid ? '#0E6888' : '#0A5060';  // deep trough

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <Animated.View style={[styles.container, shakeStyle]}>
            <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
                <Defs>
                    {/* Sky — 3-stop gradient from near-black to deep navy */}
                    <LinearGradient id="skyG" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor={skyTop} />
                        <Stop offset="0.5" stopColor={skyMid} />
                        <Stop offset="1" stopColor={skyBot} />
                    </LinearGradient>

                    {/* Ocean surface gradient — deep at bottom, slightly lighter at horizon */}
                    <LinearGradient id="oceanG" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor="#0C1E30" stopOpacity="0.6" />
                        <Stop offset="1" stopColor={oceanBase} stopOpacity="1" />
                    </LinearGradient>

                    {/* Horizon mist — atmospheric sea fog blending sky into ocean */}
                    <LinearGradient id="mist1" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor="#6A90B0" stopOpacity="0.0" />
                        <Stop offset="0.5" stopColor="#4A6A88" stopOpacity="0.12" />
                        <Stop offset="1" stopColor="#3A5870" stopOpacity="0.0" />
                    </LinearGradient>

                    {/* Ocean shimmer — thin luminous strip at the waterline */}
                    <LinearGradient id="shimmer" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor="#4890B0" stopOpacity="0.22" />
                        <Stop offset="1" stopColor="#2A6888" stopOpacity="0.0" />
                    </LinearGradient>

                    {/* Moon radial glow removed — bare crescent only */}

                    <ClipPath id="sc">
                        <Rect x={SX} y={SY} width={SW} height={SH} rx={SR} />
                    </ClipPath>
                </Defs>

                <G clipPath="url(#sc)">

                    {/* ── SKY ──────────────────────────────────────────────── */}
                    <Rect x={SX} y={SY} width={SW} height={HZ - SY} fill="url(#skyG)" />

                    {/* ── STARS — static path, zero animation cost ─────────── */}
                    <AnimatedPath
                        d={STARS}
                        stroke="#C8DCFF"
                        strokeWidth={1.0}
                        fill="none"
                        strokeLinecap="round"
                        animatedProps={starsP}
                    />

                    {/* ── MOON — crescent tilted opposite side ────────────── */}
                    {/* rotation=−28° CCW: horns point ~11→5 o'clock */}
                    <G rotation={-28} originX={MX} originY={MY}>
                        <AnimatedPath
                            d={MOON_PATH}
                            fill="#C8DCF0"
                            animatedProps={moonP}
                        />
                    </G>

                    {/* ── LIGHTNING — OPTIMIZED: single path per lane instead of 3 layers ──── */}

                    {/* Lane 1: layered bolt for richer thunder look */}
                    <AnimatedPath d={LG_PATHS[0]} animatedProps={lgP1}
                        stroke={lgOuter} strokeWidth={13} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    <AnimatedPath d={LG_PATHS[0]} animatedProps={lgP1}
                        stroke={lgMid} strokeWidth={6.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    <AnimatedPath d={LG_PATHS[0]} animatedProps={lgP1}
                        stroke={lgCore} strokeWidth={2.1} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    <AnimatedPath d={BR_PATHS[0]} animatedProps={brP1}
                        stroke={lgMid} strokeWidth={3.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    <AnimatedPath d={BR_PATHS[0]} animatedProps={brP1}
                        stroke={lgCore} strokeWidth={1.25} fill="none" strokeLinecap="round" strokeLinejoin="round" />

                    {/* Lane 2: layered bolt for richer thunder look */}
                    <AnimatedPath d={LG_PATHS[1]} animatedProps={lgP2}
                        stroke={lgOuter} strokeWidth={13} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    <AnimatedPath d={LG_PATHS[1]} animatedProps={lgP2}
                        stroke={lgMid} strokeWidth={6.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    <AnimatedPath d={LG_PATHS[1]} animatedProps={lgP2}
                        stroke={lgCore} strokeWidth={2.1} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    <AnimatedPath d={BR_PATHS[1]} animatedProps={brP2}
                        stroke={lgMid} strokeWidth={3.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    <AnimatedPath d={BR_PATHS[1]} animatedProps={brP2}
                        stroke={lgCore} strokeWidth={1.25} fill="none" strokeLinecap="round" strokeLinejoin="round" />

                    {/* Lane 3: layered bolt for richer thunder look */}
                    <AnimatedPath d={LG_PATHS[2]} animatedProps={lgP3}
                        stroke={lgOuter} strokeWidth={13} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    <AnimatedPath d={LG_PATHS[2]} animatedProps={lgP3}
                        stroke={lgMid} strokeWidth={6.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    <AnimatedPath d={LG_PATHS[2]} animatedProps={lgP3}
                        stroke={lgCore} strokeWidth={2.1} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    <AnimatedPath d={BR_PATHS[2]} animatedProps={brP3}
                        stroke={lgMid} strokeWidth={3.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    <AnimatedPath d={BR_PATHS[2]} animatedProps={brP3}
                        stroke={lgCore} strokeWidth={1.25} fill="none" strokeLinecap="round" strokeLinejoin="round" />

                    {/* ── OCEAN ─────────────────────────────────────────────── */}
                    <Rect x={SX} y={HZ} width={SW} height={SY + SH - HZ}
                        fill={oceanBase} />
                    {/* Subtle horizon-to-depth gradient overlay */}
                    <Rect x={SX} y={HZ} width={SW} height={SY + SH - HZ}
                        fill="url(#oceanG)" />

                    {/* ── HORIZON MIST — atmospheric sea fog layer ─────────── */}
                    {/* Wide band spanning the horizon, blends sky into ocean */}
                    <Rect x={SX} y={HZ - 18} width={SW} height={36}
                        fill="url(#mist1)" />
                    {/* Shimmer strip — thin luminous waterline catch-light */}
                    <Rect x={SX} y={HZ - 2} width={SW} height={10}
                        fill="url(#shimmer)" />
                    {/* Horizon sea spray — fine static foam dashes at waterline */}
                    <Path
                        d={HORIZON_SPRAY}
                        stroke="#90B8CC"
                        strokeWidth={0.7}
                        fill="none"
                        strokeLinecap="round"
                        opacity={0.28}
                    />

                    {/* ── WAVES — 4 layers, all driven by single waveX value ── */}
                    {/* Layer 1: near-horizon glimmer, finest and fastest */}
                    <AnimatedPath d={WAVE1} stroke={w1Col} strokeWidth={1.6}
                        fill="none" opacity={0.65} animatedProps={w1P} />
                    {/* Layer 2: mid swell, moderate */}
                    <AnimatedPath d={WAVE2} stroke={w2Col} strokeWidth={2.2}
                        fill="none" opacity={0.58} animatedProps={w2P} />
                    {/* Layer 3: large swell, prominent */}
                    <AnimatedPath d={WAVE3} stroke={w3Col} strokeWidth={2.6}
                        fill="none" opacity={0.48} animatedProps={w3P} />
                    {/* Layer 4: deep foreground trough, slowest */}
                    <AnimatedPath d={WAVE4} stroke={w4Col} strokeWidth={2.0}
                        fill="none" opacity={0.35} animatedProps={w4P} />

                    {/* ── SHIP ──────────────────────────────────────────────── */}
                    <AnimatedG animatedProps={shipP}>
                        <Path d={HULL} fill="#131F2C" />
                        <Path d={CABIN} fill="#243344" />
                        <Path d={FUNNEL} fill="#09101A" />
                        {/* Funnel smoke-stack band */}
                        <Path
                            d={`M${SHX + 19} ${SHY - 2} L${SHX + 25} ${SHY - 2}`}
                            stroke="#B02424" strokeWidth={1.6} strokeLinecap="butt"
                        />
                        <Path d={MAST} stroke="#243344" strokeWidth={1.0} strokeLinecap="round" />
                        <Path d={BOW} stroke="#243344" strokeWidth={1.2} strokeLinecap="round" />
                        {/* Porthole windows */}
                        <Rect x={SHX + 7} y={SHY + 3} width={3} height={2.2} rx={0.6} fill="#78AACC" opacity={0.90} />
                        <Rect x={SHX + 13} y={SHY + 3} width={3} height={2.2} rx={0.6} fill="#78AACC" opacity={0.90} />
                        <Rect x={SHX + 19} y={SHY + 3} width={2.5} height={2.2} rx={0.6} fill="#78AACC" opacity={0.52} />
                        {/* Waterline stripe */}
                        <Path
                            d={`M${SHX - 16} ${SHY + 9} L${SHX + 39} ${SHY + 9}`}
                            stroke="#2C4A62" strokeWidth={0.7} opacity={0.58}
                        />
                        {/* Running lights */}
                        <Circle cx={SHX - 13} cy={SHY + 11.5} r={1.3} fill="#FF2828" opacity={0.88} />
                        <Circle cx={SHX + 42} cy={SHY + 11.5} r={1.3} fill="#22C044" opacity={0.88} />
                        {/* Masthead light */}
                        <Circle cx={SHX + 13} cy={SHY - 16} r={1.0} fill="#EEF0FF" opacity={0.80} />
                    </AnimatedG>

                    {/* ── RAIN — heavy layer (angled 12°) ─────────────────── */}
                    <AnimatedG animatedProps={rainAP}>
                        <Path d={RAIN_HEAVY} stroke="#7AA0BE" strokeWidth={0.85}
                            fill="none" strokeLinecap="round" opacity={0.42} />
                    </AnimatedG>
                    <AnimatedG animatedProps={rainBP}>
                        <Path d={RAIN_HEAVY} stroke="#7AA0BE" strokeWidth={0.85}
                            fill="none" strokeLinecap="round" opacity={0.42} />
                    </AnimatedG>

                    {/* ── RAIN — fine mist layer (near-vertical, offset speed) ─ */}
                    <AnimatedG animatedProps={rainMAP}>
                        <Path d={RAIN_MIST} stroke="#A8C4D8" strokeWidth={0.55}
                            fill="none" strokeLinecap="round" opacity={0.22} />
                    </AnimatedG>
                    <AnimatedG animatedProps={rainMBP}>
                        <Path d={RAIN_MIST} stroke="#A8C4D8" strokeWidth={0.55}
                            fill="none" strokeLinecap="round" opacity={0.22} />
                    </AnimatedG>

                    {/* ── LIGHTNING FLASH OVERLAY — full scene white-out pulse ─ */}
                    <AnimatedRect
                        x={SX} y={SY} width={SW} height={SH}
                        fill="#D8EEFF"
                        animatedProps={lgFlshP}
                    />

                </G>

                {/* ── FRAME BORDER ─────────────────────────────────────────── */}
                <Rect
                    x={SX} y={SY} width={SW} height={SH} rx={SR}
                    fill="none"
                    stroke={color ?? '#405868'}
                    strokeWidth={1.2}
                    opacity={0.35}
                />

            </Svg>

            {/* ── MOVIE SUBTITLE — absolute overlay, native Animated.View ─── */}
            <Animated.View
                pointerEvents="none"
                style={[styles.subtitleWrap, subtitleStyle]}
            >
                <Text style={styles.subtitleText}>
                    [ THUNDER RUMBLING ]
                </Text>
            </Animated.View>

        </Animated.View>
    );
}

export default React.memo(StormSceneAnimatedIcon);

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        width: W,
        height: H,
    },
    subtitleWrap: {
        position: 'absolute',
        bottom: H - (SY + SH - 10),
        left: SX + SR,
        right: W - (SX + SW - SR),
        alignItems: 'center',
    },
    subtitleText: {
        color: '#ffffffff',
        fontSize: 10,
        fontWeight: '600',
        fontFamily: SUBTITLE_FONT_FAMILY,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
    },
});
