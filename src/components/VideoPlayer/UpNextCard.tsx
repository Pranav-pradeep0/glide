import React, { useEffect, useRef } from 'react';
import { Image, StyleSheet, Text, View, type HostInstance } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { Feather } from '@react-native-vector-icons/feather';
import { IconButton, Touchable } from '@/components/ui';
import { ProgressLine, prettyTitle, progressOf } from '@/components/VideoRow';
import { useThumbnail } from '@/hooks/useThumbnails';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import { metrics, motion, playerTheme, type } from '@/theme/theme';
import { useTvFocusScope } from '@/hooks/video-player/useTvRemote';

const { colors } = playerTheme;

/** How long autoplay waits before playing the next video. */
export const UP_NEXT_COUNTDOWN_MS = 10_000;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const RING = 44;
const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface Props {
    name: string;
    path: string;
    /** When autoplay will start it; null = no countdown (autoplay off). */
    endsAt: number | null;
    /** Shown in the credits, not at the end: ✕ means "keep watching them". */
    inCredits?: boolean;
    /** Both absent while the screen is locked: the card informs, it can't be acted on. */
    onPlay?: () => void;
    onDismiss?: () => void;
    /** Insets (and controls) to clear; the card adds its own margin. */
    bottom: number;
    right: number;
}

/**
 * Shown once a video's credits start (or it ends) and the folder has another. The screen owns
 * the timer that plays it; the ring around Play drains with it on the UI thread, so nothing
 * re-renders per second.
 */
export function UpNextCard({ name, path, endsAt, inCredits, onPlay, onDismiss, bottom, right }: Props) {
    const { thumbnail } = useThumbnail(path);
    const progress = useVideoHistoryStore((s) => {
        const entry = s.getVideoHistory(path);
        return progressOf(entry?.duration, entry?.lastPausedPosition);
    });
    const { title, detail } = prettyTitle(name);
    // TV: the remote goes to Play next while the card shows; Back (the screen's) dismisses it.
    const cardRef = useRef<HostInstance>(null);
    useTvFocusScope(cardRef, !!onPlay);

    const left = useSharedValue(0);
    useEffect(() => {
        if (endsAt === null) { return; }
        const remaining = Math.max(0, endsAt - Date.now());
        left.value = remaining / UP_NEXT_COUNTDOWN_MS;
        left.value = withTiming(0, { duration: remaining, easing: Easing.linear });
    }, [endsAt, left]);
    const ringProps = useAnimatedProps(() => ({ strokeDashoffset: CIRCUMFERENCE * (1 - left.value) }));

    // Follows the controls up and down instead of jumping.
    const lift = useSharedValue(bottom);
    useEffect(() => { lift.value = withTiming(bottom, { duration: motion.fadeIn }); }, [bottom, lift]);
    const liftStyle = useAnimatedStyle(() => ({ bottom: lift.value + metrics.space.lg }));

    const art = (
        <View style={styles.thumb}>
            {thumbnail
                ? <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                : <Feather name="video" size={22} color={colors.textTertiary} />}
            {progress > 0 && <ProgressLine progress={progress} style={styles.progress} />}
            {onPlay && (
                <View style={styles.playDisc}>
                    {endsAt !== null && (
                        <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
                            <AnimatedCircle
                                cx={RING / 2}
                                cy={RING / 2}
                                r={RADIUS}
                                stroke={colors.text}
                                strokeWidth={2.5}
                                strokeLinecap="round"
                                fill="none"
                                strokeDasharray={CIRCUMFERENCE}
                                animatedProps={ringProps}
                                // Start at 12 o'clock and drain clockwise.
                                transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
                            />
                        </Svg>
                    )}
                    <Feather name="play" size={18} color={colors.text} style={styles.playGlyph} />
                </View>
            )}
        </View>
    );

    return (
        <Animated.View
            ref={cardRef}
            collapsable={false}
            entering={FadeIn.duration(motion.fadeIn)}
            exiting={FadeOut.duration(motion.fadeOut)}
            style={[styles.card, { right: right + metrics.gutter }, liftStyle]}
        >
            {onPlay
                ? <Touchable onPress={onPlay} onPlayer scaleTo={0.96} accessibilityRole="button" accessibilityLabel={`Play ${title} now`}>{art}</Touchable>
                : art}
            <View style={styles.info}>
                <Text maxFontSizeMultiplier={metrics.playerFontScale} style={[type.caption, styles.heading]}>Up next</Text>
                <Text maxFontSizeMultiplier={metrics.playerFontScale} style={[type.body, styles.title]} numberOfLines={2}>{title}</Text>
                {detail ? <Text maxFontSizeMultiplier={metrics.playerFontScale} style={[type.caption, styles.detail]} numberOfLines={1}>{detail}</Text> : null}
            </View>
            {onDismiss && (
                <IconButton icon="x" iconSize={18} onPress={onDismiss} accessibilityLabel={inCredits ? 'Watch credits' : endsAt === null ? 'Close' : 'Cancel autoplay'} onPlayer style={styles.dismiss} />
            )}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    card: {
        position: 'absolute',
        width: 340,
        maxWidth: '90%',
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.md,
        padding: metrics.space.sm,
        borderRadius: metrics.radius.lg,
        backgroundColor: colors.cardElevated,
    },
    thumb: {
        width: 128,
        height: 72,
        borderRadius: metrics.radius.sm,
        overflow: 'hidden',
        backgroundColor: colors.surfaceVariant,
        alignItems: 'center',
        justifyContent: 'center',
    },
    progress: { position: 'absolute', left: 0, right: 0, bottom: 0 },
    playDisc: {
        width: RING,
        height: RING,
        borderRadius: RING / 2,
        backgroundColor: 'rgba(0,0,0,0.5)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    // The play triangle's visual centre sits left of its box.
    playGlyph: { marginLeft: 2 },
    info: { flex: 1, gap: 2 },
    heading: { color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
    title: { color: colors.text },
    detail: { color: colors.textTertiary },
    // 48 dp box: pull it into the corner padding so the glyph stays where it was.
    dismiss: { alignSelf: 'flex-start', marginTop: -4, marginRight: -4 },
});
