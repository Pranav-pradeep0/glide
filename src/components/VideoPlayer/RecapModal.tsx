import React, { memo, useMemo, useRef, useState } from 'react';
import {
    StyleSheet,
    View,
    Text,
    Pressable,
    ScrollView,
    ActivityIndicator,
    useWindowDimensions,
    type HostInstance,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Button, SheetHeader } from '@/components/ui';
import { useTvFocusScope } from '@/hooks/video-player/useTvRemote';
import { IS_TV } from '@/utils/tv';
import { PLAYER_BACKDROP } from '@/theme/colors';
import { metrics, motion, playerTheme, type } from '@/theme/theme';
import { parseEmphasis } from '@/utils/markdownEmphasis';
import { RecapService } from '@/services/RecapService';

const { colors } = playerTheme;

interface RecapModalProps {
    visible: boolean;
    /** X, backdrop, Back: closes and stays paused. */
    onClose: () => void;
    /** The Resume button: closes and plays. */
    onResume: () => void;
    recapText: string | null; // null means loading
    videoName: string;
    isLoading?: boolean;
    loadingMessage?: string;
}

/**
 * Drawn in the player's own window, not a Modal: opening it from Continue watching swaps one
 * overlay for another without a new window, and it stays mounted so both fades play.
 * Back is the player screen's.
 */
export const RecapModal: React.FC<RecapModalProps> = memo(({
    visible,
    onClose,
    onResume,
    recapText,
    videoName,
    isLoading = false,
    loadingMessage,
}) => {
    const { width, height } = useWindowDimensions();
    // Keyed by text, so a new recap can be reported again without a reset effect.
    const [reported, setReported] = useState<{ text: string; status: 'sending' | 'sent' | 'failed' } | null>(null);
    const reportStatus = reported && reported.text === recapText ? reported.status : null;
    const spans = useMemo(() => (recapText ? parseEmphasis(recapText) : []), [recapText]);
    // D-pad focus: the same ring the shared Touchable draws.
    const [reportFocused, setReportFocused] = useState(false);

    // TV: the remote starts on Resume and stays in here until it closes.
    const overlayRef = useRef<HostInstance>(null);
    const resumeRef = useRef<HostInstance>(null);
    useTvFocusScope(overlayRef, visible, resumeRef);

    if (!visible) {return null;}

    const report = (text: string) => {
        setReported({ text, status: 'sending' });
        RecapService.reportRecap(text, videoName).then(ok => setReported({ text, status: ok ? 'sent' : 'failed' }));
    };

    const isLandscape = width > height;
    const showLoading = isLoading || recapText === null;
    const contentWidth = isLandscape ? Math.min(width * 0.7, 600) : Math.min(width * 0.9, 500);
    const scrollMaxHeight = isLandscape ? height * 0.45 : height * 0.5;

    return (
        <Animated.View
            ref={overlayRef}
            collapsable={false}
            style={styles.overlay}
            entering={FadeIn.duration(motion.fadeIn)}
            exiting={FadeOut.duration(motion.fadeOut)}
            accessibilityViewIsModal
        >
            <Pressable
                focusable={!IS_TV}
                accessible={!IS_TV}
                style={StyleSheet.absoluteFill}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close recap"
            />
            <View style={[styles.card, { width: contentWidth, maxHeight: height * 0.85 }]}>
                <SheetHeader title={videoName} onClose={onClose} onPlayer />

                {showLoading ? (
                    <View style={styles.loading} accessibilityLiveRegion="polite">
                        <ActivityIndicator size="small" color={colors.textSecondary} />
                        <Text style={styles.loadingText}>{loadingMessage ?? 'Preparing your recap…'}</Text>
                    </View>
                ) : (
                    <ScrollView style={{ maxHeight: scrollMaxHeight }} showsVerticalScrollIndicator={false}>
                        <Animated.Text entering={FadeIn.duration(motion.fadeIn)} style={styles.recapText}>
                            {spans.map((span, i) => (span.bold || span.italic
                                ? <Text key={i} style={span.bold ? styles.bold : styles.italic}>{span.text}</Text>
                                : span.text
                            ))}
                        </Animated.Text>
                        <Text style={styles.disclosure}>
                            Written by AI from the subtitles. It can be wrong or contain spoilers.
                        </Text>
                        <Pressable
                            onPress={() => report(recapText)}
                            disabled={reportStatus === 'sending' || reportStatus === 'sent'}
                            hitSlop={metrics.space.sm}
                            accessibilityRole="button"
                            onFocus={() => setReportFocused(true)}
                            onBlur={() => setReportFocused(false)}
                            style={[styles.reportRow, reportFocused && styles.focused]}
                        >
                            <Text style={styles.reportText}>
                                {reportStatus === 'sent' ? 'Reported. Thanks.'
                                    : reportStatus === 'sending' ? 'Reporting…'
                                    : reportStatus === 'failed' ? 'Could not send. Tap to try again.'
                                    : 'Report this recap'}
                            </Text>
                        </Pressable>
                    </ScrollView>
                )}

                <View ref={resumeRef} collapsable={false}>
                    <Button
                        label={showLoading ? 'Skip and resume' : 'Resume'}
                        variant="primary"
                        size="lg"
                        icon="play"
                        onPress={onResume}
                        onPlayer
                    />
                </View>
            </View>
        </Animated.View>
    );
});

RecapModal.displayName = 'RecapModal';

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFill,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: PLAYER_BACKDROP,
    },
    card: {
        backgroundColor: colors.cardElevated,
        borderRadius: metrics.radius.card,
        paddingHorizontal: metrics.space.lg,
        paddingTop: metrics.space.md,
        paddingBottom: metrics.space.lg,
        gap: metrics.space.lg,
    },
    loading: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: metrics.space.sm,
        paddingVertical: metrics.space.xl,
    },
    loadingText: { ...type.body, color: colors.textSecondary },
    recapText: { ...type.body, color: colors.text, fontSize: 16, lineHeight: 24 },
    disclosure: { ...type.caption, color: colors.textSecondary, marginTop: metrics.space.md },
    reportRow: { alignSelf: 'flex-start', minHeight: 48, justifyContent: 'center' },
    focused: { outlineWidth: metrics.focus.ring, outlineOffset: 2, outlineColor: colors.primary, borderRadius: metrics.radius.sm },
    reportText: { ...type.caption, color: colors.textSecondary, textDecorationLine: 'underline' },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
});
