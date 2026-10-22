/**
 * Placeholder rows shown while a list loads, shaped like the real rows so nothing jumps
 * when they arrive. One pulse on the UI thread fades every bone together; with reduce
 * motion on, the bones sit still.
 */
import React, { useEffect } from 'react';
import { DimensionValue, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/hooks/useTheme';
import { metrics } from '@/theme/theme';

const { space, radius } = metrics;
const GRID_HALF_GAP = space.sm / 2 + 2; // as in VideoRow / MusicScreen grids

interface Shape {
    /** The artwork bone. */
    thumb: ViewStyle;
    /** Row padding and height, matching the real row; unset for a two-column card. */
    row?: ViewStyle;
    /** List side padding, matching the real list's contentContainerStyle. */
    gutter: number;
}

const SHAPES = {
    /** VideoRow. */
    video: {
        thumb: { width: 128, height: 72, borderRadius: radius.sm },
        row: { paddingVertical: space.sm, paddingLeft: space.sm, marginBottom: 2 },
        gutter: metrics.gutter - space.sm,
    },
    /** VideoCard. */
    videoCard: { thumb: { aspectRatio: 16 / 9, borderRadius: radius.sm }, gutter: metrics.gutter - GRID_HALF_GAP },
    /** FoldersScreen list row. */
    folder: {
        thumb: { width: 88, height: 56, borderRadius: radius.sm },
        row: { minHeight: 72, padding: space.sm, marginBottom: 2 },
        gutter: metrics.gutter - space.sm,
    },
    /** FoldersScreen grid card. */
    folderCard: { thumb: { aspectRatio: 16 / 10, borderRadius: radius.sm }, gutter: metrics.gutter - GRID_HALF_GAP },
    /** TrackRow. */
    track: {
        thumb: { width: 44, height: 44, borderRadius: radius.sm },
        row: { minHeight: 58, paddingVertical: space.xs, paddingHorizontal: space.sm },
        gutter: metrics.gutter,
    },
    /** MusicScreen artist row. */
    artist: {
        thumb: { width: 48, height: 48, borderRadius: 24 },
        row: { minHeight: 64, padding: space.sm },
        gutter: metrics.gutter,
    },
    /** MusicScreen folder row. */
    musicFolder: {
        thumb: { width: 48, height: 48, borderRadius: radius.sm },
        row: { minHeight: 64, padding: space.sm },
        gutter: metrics.gutter,
    },
    /** MusicScreen album card. */
    album: { thumb: { aspectRatio: 1, borderRadius: radius.card }, gutter: metrics.gutter - GRID_HALF_GAP },
} satisfies Record<string, Shape>;

export type SkeletonKind = keyof typeof SHAPES;

// Varied title widths so the rows read as text, not a barcode.
const TITLE_WIDTHS: DimensionValue[] = ['72%', '54%', '84%', '63%', '78%', '46%'];
const ROWS = 10;
const CARDS = 6;
const PULSE_MS = 900;

export function SkeletonList({ kind }: { kind: SkeletonKind }) {
    const { colors } = useTheme();
    const reduceMotion = useReducedMotion();
    const pulse = useSharedValue(1);

    useEffect(() => {
        if (reduceMotion) {return;}
        pulse.value = withRepeat(withTiming(0.5, { duration: PULSE_MS, easing: Easing.inOut(Easing.ease) }), -1, true);
    }, [reduceMotion, pulse]);

    const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

    const shape: Shape = SHAPES[kind];
    const bone = { backgroundColor: colors.fillStrong };
    const lines = (i: number, row: boolean) => (
        <View style={[styles.lines, row && styles.rowLines]}>
            <View style={[styles.title, bone, { width: TITLE_WIDTHS[i % TITLE_WIDTHS.length] }]} />
            <View style={[styles.caption, bone]} />
        </View>
    );

    return (
        <View
            style={[styles.container, { paddingHorizontal: shape.gutter }]}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Loading"
            accessibilityState={{ busy: true }}
        >
            <Animated.View
                style={[shape.row ? null : styles.grid, pulseStyle]}
                importantForAccessibility="no-hide-descendants"
            >
                {Array.from({ length: shape.row ? ROWS : CARDS }, (_, i) =>
                    shape.row ? (
                        <View key={i} style={[styles.row, shape.row]}>
                            <View style={[shape.thumb, bone]} />
                            {lines(i, true)}
                        </View>
                    ) : (
                        <View key={i} style={styles.cell}>
                            <View style={[shape.thumb, bone]} />
                            {lines(i, false)}
                        </View>
                    ),
                )}
            </Animated.View>
        </View>
    );
}

// Bones are the text's cap height, centred in its line box (type.row 20, type.caption 16).
const styles = StyleSheet.create({
    container: { flex: 1, overflow: 'hidden' },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    cell: { width: '50%', paddingHorizontal: GRID_HALF_GAP, paddingBottom: space.lg, gap: space.sm },
    lines: { gap: 2 },
    rowLines: { flex: 1 },
    title: { height: 12, marginVertical: 4, borderRadius: radius.xs },
    caption: { width: '38%', height: 9, marginVertical: 3.5, borderRadius: radius.xs },
});
