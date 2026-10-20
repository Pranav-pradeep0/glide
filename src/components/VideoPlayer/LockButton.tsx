import React, { FC } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Touchable } from '@/components/ui';
import { metrics, motion, playerTheme, type } from '@/theme/theme';
import { HUD_PILL } from '@/theme/colors';

const { colors } = playerTheme;

interface LockButtonProps {
    visible: boolean;
    onUnlock: () => void;
    top: number;
    left: number;
}

/** While the screen is locked, a tap on the video shows this chip for 2 s; only tapping the chip unlocks. */
export const LockButton: FC<LockButtonProps> = ({ visible, onUnlock, top, left }) => {
    if (!visible) {return null;}

    return (
        <Animated.View
            style={[styles.container, { top, left }]}
            entering={FadeIn.duration(motion.fadeIn)}
            exiting={FadeOut.duration(motion.fadeOut)}
        >
            <Touchable
                onPress={onUnlock}
                onPlayer
                accessibilityRole="button"
                accessibilityLabel="Unlock screen"
                style={styles.chip}
            >
                <Feather name="lock" size={16} color={colors.text} />
                <Text maxFontSizeMultiplier={metrics.playerFontScale} style={styles.text}>Tap to unlock</Text>
            </Touchable>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    container: { position: 'absolute', zIndex: 100 },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.sm,
        minHeight: metrics.touch,
        paddingHorizontal: metrics.space.lg,
        borderRadius: metrics.radius.lg,
        backgroundColor: HUD_PILL,
    },
    text: { ...type.label, color: colors.text },
});
