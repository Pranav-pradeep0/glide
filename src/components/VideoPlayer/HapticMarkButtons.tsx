import React, { FC } from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import { Touchable } from '@/components/ui';
import { haptic, type HapticMark } from '@/native/HapticModule';
import { metrics, playerTheme } from '@/theme/theme';
import { HUD_PILL } from '@/theme/colors';

const { colors } = playerTheme;

interface HapticMarkButtonsProps {
    onMark: (kind: HapticMark) => void;
    right: number;
}

/**
 * Haptics layer 5, for testers: "Too much" / "Missed" over the video at all times, so a mark lands
 * on the moment without bringing up the controls first. Faint, at the right edge's middle.
 */
export const HapticMarkButtons: FC<HapticMarkButtonsProps> = ({ onMark, right }) => {
    const mark = (kind: HapticMark) => { onMark(kind); haptic('confirm'); };
    return (
        <View style={[styles.container, { right }]} pointerEvents="box-none">
            <Touchable onPress={() => mark('too-much')} onPlayer accessibilityRole="button" accessibilityLabel="Haptics too much here" style={styles.button}>
                <Feather name="zap-off" size={20} color={colors.text} />
            </Touchable>
            <Touchable onPress={() => mark('missed')} onPlayer accessibilityRole="button" accessibilityLabel="Haptics missed here" style={styles.button}>
                <Feather name="zap" size={20} color={colors.text} />
            </Touchable>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', gap: metrics.space.md, zIndex: 100, opacity: 0.5 },
    button: {
        width: metrics.touch,
        height: metrics.touch,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: metrics.touch / 2,
        backgroundColor: HUD_PILL,
    },
});
