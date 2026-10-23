import React, { memo, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, type HostInstance } from 'react-native';
import { useTvFocusScope } from '@/hooks/video-player/useTvRemote';
import { IS_TV } from '@/utils/tv';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Button, SheetHeader } from '@/components/ui';
import { PLAYER_BACKDROP } from '@/theme/colors';
import { metrics, motion, playerTheme, type } from '@/theme/theme';

const { colors } = playerTheme;

/** 1h 20m 5s, 20m 30s, 30s. Zero parts are dropped. */
const formatVerboseTime = (seconds: number): string => {
    if (!isFinite(seconds) || seconds < 0) {return '';}

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts = [];
    if (hrs > 0) {parts.push(`${hrs}h`);}
    if (mins > 0) {parts.push(`${mins}m`);}
    if (secs > 0 || parts.length === 0) {parts.push(`${secs}s`);}
    return parts.join(' ');
};

interface ResumeModalProps {
    visible: boolean;
    formattedResumeTime: string;
    remainingTime?: number;
    finishByTime?: string;
    showRecapOption: boolean;
    isGeneratingRecap?: boolean;
    /** Eligibility is still being worked out: show Recap with a spinner, not yet tappable. */
    recapChecking?: boolean;
    onResume: () => void;
    onRestart: () => void;
    onRecap: () => void;
    onClose: () => void;
}

/** In the player's own window like RecapModal, and mounted throughout so its fade-out plays. Back is the screen's. */
export const ResumeModal: React.FC<ResumeModalProps> = memo(({
    visible,
    formattedResumeTime,
    remainingTime,
    finishByTime,
    showRecapOption,
    isGeneratingRecap = false,
    recapChecking = false,
    onResume,
    onRestart,
    onRecap,
    onClose,
}) => {
    // TV: the remote starts on Resume and stays in here until it closes.
    const overlayRef = useRef<HostInstance>(null);
    const resumeRef = useRef<HostInstance>(null);
    useTvFocusScope(overlayRef, visible, resumeRef);

    if (!visible) {return null;}

    const formattedRemaining = remainingTime !== undefined ? formatVerboseTime(remainingTime) : '';
    const caption = [
        formattedRemaining && `${formattedRemaining} left`,
        finishByTime && `ends ${finishByTime}`,
    ].filter(Boolean).join(' · ');

    return (
        <Animated.View
            ref={overlayRef}
            collapsable={false}
            style={styles.overlay}
            entering={FadeIn.duration(motion.fadeIn)}
            exiting={FadeOut.duration(motion.fadeOut)}
            accessibilityViewIsModal
        >
            {/* Same as the close button: dismissing never starts playback. */}
            <Pressable
                focusable={!IS_TV}
                accessible={!IS_TV}
                style={StyleSheet.absoluteFill}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
            />
            <View style={styles.card}>
                <SheetHeader title="Continue watching" onClose={onClose} onPlayer />

                <View style={styles.valueBox} accessible={!IS_TV} accessibilityLabel={`Resume from ${formattedResumeTime}. ${caption}`}>
                    <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
                        {formattedResumeTime}
                    </Text>
                    {!!caption && <Text style={styles.caption} numberOfLines={2}>{caption}</Text>}
                </View>

                <View style={styles.actions}>
                    <View style={styles.secondaryRow}>
                        <Button label="Start over" onPress={onRestart} onPlayer style={styles.flex} />
                        {showRecapOption && (
                            <Button
                                label="Recap"
                                onPress={onRecap}
                                loading={isGeneratingRecap || recapChecking}
                                accessibilityLabel="Recap what happened so far"
                                onPlayer
                                style={styles.flex}
                            />
                        )}
                    </View>
                    <View ref={resumeRef} collapsable={false}>
                        <Button label="Resume" variant="primary" size="lg" icon="play" onPress={onResume} onPlayer />
                    </View>
                </View>
            </View>
        </Animated.View>
    );
});

ResumeModal.displayName = 'ResumeModal';

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFill,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: PLAYER_BACKDROP,
    },
    card: {
        width: '92%',
        maxWidth: 420,
        backgroundColor: colors.cardElevated,
        borderRadius: metrics.radius.card,
        paddingHorizontal: metrics.space.lg,
        paddingTop: metrics.space.md,
        paddingBottom: metrics.space.lg,
        gap: metrics.space.lg,
    },
    valueBox: { alignItems: 'center', gap: 2 },
    value: { ...type.hero, color: colors.text },
    caption: { ...type.caption, color: colors.textSecondary, textAlign: 'center' },
    actions: { gap: metrics.space.sm },
    secondaryRow: { flexDirection: 'row', gap: metrics.space.sm },
    flex: { flex: 1 },
});
