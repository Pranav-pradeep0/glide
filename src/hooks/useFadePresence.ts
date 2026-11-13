import { useEffect, useState } from 'react';
import { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { motion } from '@/theme/theme';

/**
 * Fades an overlay in and out, keeping it mounted until the fade-out ends. An `entering` /
 * `exiting` layout animation interrupted by a re-layout (the player rotating as it opens)
 * could stop part-way and leave the overlay see-through; this opacity always ends at 1 or 0.
 */
export function useFadePresence(visible: boolean) {
    const [mounted, setMounted] = useState(visible);
    const opacity = useSharedValue(0);
    useEffect(() => {
        if (visible) {
            setMounted(true);
            opacity.value = withTiming(1, { duration: motion.fadeIn });
        } else {
            opacity.value = withTiming(0, { duration: motion.fadeOut }, (done) => {
                if (done) { runOnJS(setMounted)(false); }
            });
        }
    }, [visible, opacity]);
    const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
    return { mounted: visible || mounted, style };
}
