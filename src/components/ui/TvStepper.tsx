import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { IconButton, useUiTheme } from '@/components/ui';
import { metrics, type } from '@/theme/theme';

/**
 * The next value on the step grid counted from `min`, clamped to [min, max]. An off-grid value
 * (set by a phone's slider or a pinch) moves to its nearest grid neighbour in that direction.
 */
export function stepValue(value: number, dir: 1 | -1, min: number, max: number, step: number): number {
    const i = (value - min) / step;
    const n = dir > 0 ? Math.floor(i + 1e-6) + 1 : Math.ceil(i - 1e-6) - 1;
    // Rounded so 0.1 steps don't drift to 0.30000000000000004.
    return Math.min(max, Math.max(min, Math.round((min + n * step) * 1e6) / 1e6));
}

interface TvStepperProps {
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
    /** The value as shown, e.g. "20 px". */
    format?: (value: number) => string;
    accessibilityLabel: string;
    /** A row of its own with this title on the left (panels); the control drops under it when narrow. */
    title?: string;
    disabled?: boolean;
    onPlayer?: boolean;
}

/**
 * The TV form of a slider: − value +. Stock RN gives JS no D-pad keys outside the player, so a
 * slider can't be moved with the remote; each OK on − or + moves one step. The buttons are
 * IconButtons, so they get the TV focus ring. At an end its button only dims and does nothing:
 * a disabled view can't hold Android focus, which would jump elsewhere and take the next OK.
 */
export function TvStepper({ value, min, max, step, onChange, format, accessibilityLabel, title, disabled, onPlayer }: TvStepperProps) {
    const { colors } = useUiTheme(onPlayer);
    const fontScale = onPlayer ? metrics.playerFontScale : undefined;
    const atMin = value <= min;
    const atMax = value >= max;
    const control = (
        <View style={styles.control}>
            <IconButton
                icon="minus"
                fill={colors.fillStrong}
                color={atMin ? colors.textTertiary : undefined}
                onPress={() => !atMin && onChange(stepValue(value, -1, min, max, step))}
                disabled={disabled}
                accessibilityLabel={`${accessibilityLabel}, decrease`}
                onPlayer={onPlayer}
            />
            <Text maxFontSizeMultiplier={fontScale} numberOfLines={1} style={[type.body, styles.value, { color: colors.text }]}>
                {format ? format(value) : String(value)}
            </Text>
            <IconButton
                icon="plus"
                fill={colors.fillStrong}
                color={atMax ? colors.textTertiary : undefined}
                onPress={() => !atMax && onChange(stepValue(value, 1, min, max, step))}
                disabled={disabled}
                accessibilityLabel={`${accessibilityLabel}, increase`}
                onPlayer={onPlayer}
            />
        </View>
    );
    if (!title) { return control; }
    return (
        <View style={styles.row}>
            <Text maxFontSizeMultiplier={fontScale} style={[type.row, styles.title, { color: colors.text }]}>{title}</Text>
            {control}
        </View>
    );
}

const styles = StyleSheet.create({
    // Matches ListRow's padding so it sits in a ListGroup with them.
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        // Keeps the control on the right when it wraps under the title.
        justifyContent: 'flex-end',
        minHeight: 56,
        paddingHorizontal: metrics.space.lg,
        paddingVertical: metrics.space.xs,
        columnGap: metrics.space.lg,
    },
    title: { flexGrow: 1, flexShrink: 1, fontWeight: '400' },
    // Centred when it has a column to itself.
    control: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', flexShrink: 1 },
    // A fixed minimum so the buttons don't shift as the label changes width.
    value: { minWidth: 64, flexShrink: 1, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
