import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Button } from '@/components/ui';
import { metrics, motion } from '@/theme/theme';
import type { SkipKind } from '@/utils/skipChapters';

interface Props {
    kind: SkipKind;
    onSkip: () => void;
    /** Insets (and controls) to clear; the button adds its own margin. */
    bottom: number;
    right: number;
}

/** "Skip intro" / "Skip recap" while a named chapter for one plays. */
export function SkipChapterButton({ kind, onSkip, bottom, right }: Props) {
    // Follows the controls up and down instead of jumping, like Up next.
    const lift = useSharedValue(bottom);
    useEffect(() => { lift.value = withTiming(bottom, { duration: motion.fadeIn }); }, [bottom, lift]);
    const liftStyle = useAnimatedStyle(() => ({ bottom: lift.value + metrics.space.lg }));

    return (
        <Animated.View
            entering={FadeIn.duration(motion.fadeIn)}
            exiting={FadeOut.duration(motion.fadeOut)}
            style={[styles.wrap, { right: right + metrics.gutter }, liftStyle]}
        >
            <Button label={kind === 'intro' ? 'Skip intro' : 'Skip recap'} icon="skip-forward" size="lg" onPress={onSkip} onPlayer />
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    wrap: { position: 'absolute' },
});
