import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useTheme } from '@/hooks/useTheme';
import { useAudioStore } from '@/store/audioStore';
import { formatDuration } from '@/utils/formatUtils';
import { metrics, type } from '@/theme/theme';

interface NowPlayingProgressBarProps {
    accentColor: string;
    trackDuration?: number;
}

/**
 * Isolated progress and seek slider for NowPlayingScreen.
 *
 * Subscribes to `position` and `duration` independently from `useAudioStore`,
 * preventing the entire NowPlayingScreen from re-rendering twice every second.
 */
export const NowPlayingProgressBar: React.FC<NowPlayingProgressBarProps> = React.memo(({
    accentColor,
    trackDuration = 0,
}) => {
    const { colors } = useTheme();

    const position = useAudioStore((s) => s.position);
    const duration = useAudioStore((s) => s.duration);
    const seekTo = useAudioStore((s) => s.seekTo);

    const [isSeeking, setIsSeeking] = useState(false);
    const [seekValue, setSeekValue] = useState(0);

    const handleSlidingStart = useCallback((val: number) => {
        setIsSeeking(true);
        setSeekValue(val);
    }, []);

    const handleSlidingComplete = useCallback(
        (val: number) => {
            setIsSeeking(false);
            seekTo(val);
        },
        [seekTo]
    );

    const currentPosition = isSeeking ? seekValue : position;
    const effectiveDuration = duration > 0 ? duration : trackDuration;

    return (
        <View style={styles.scrubberArea}>
            <Slider
                style={styles.slider}
                value={currentPosition}
                minimumValue={0}
                maximumValue={effectiveDuration > 0 ? effectiveDuration : 1}
                onSlidingStart={handleSlidingStart}
                onValueChange={(val) => setSeekValue(val)}
                onSlidingComplete={handleSlidingComplete}
                minimumTrackTintColor={accentColor}
                maximumTrackTintColor={colors.fillStrong}
                thumbTintColor={accentColor}
            />
            <View style={styles.timeRow}>
                <Text style={[type.caption, styles.timeText, { color: colors.textSecondary }]}>
                    {formatDuration(currentPosition)}
                </Text>
                <Text style={[type.caption, styles.timeText, { color: colors.textSecondary }]}>
                    {formatDuration(effectiveDuration)}
                </Text>
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
    scrubberArea: {
        paddingVertical: metrics.space.xs,
    },
    slider: {
        width: '100%',
        height: 40,
    },
    timeRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: metrics.space.xs,
        marginTop: -6,
    },
    timeText: {
        fontVariant: ['tabular-nums'],
    },
});
