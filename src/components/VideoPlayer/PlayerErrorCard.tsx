import React, { useRef } from 'react';
import { Linking, StyleSheet, Text, View, type HostInstance } from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import { Button } from '@/components/ui';
import { metrics, playerTheme, type } from '@/theme/theme';
import { describePlayerError } from '@/utils/playerErrors';
import { useTvFocusScope } from '@/hooks/video-player/useTvRemote';
import { IS_TV } from '@/utils/tv';

const { colors } = playerTheme;

interface Props {
    code: string;
    /** The share's host, when the video is on one. */
    server?: string;
    onRetry: () => void;
    onNext?: () => void;
    onClose: () => void;
}

/** Sits over the video, outside the auto-hiding controls, so it stays until acted on. */
export function PlayerErrorCard({ code, server, onRetry, onNext, onClose }: Props) {
    const { title, body } = describePlayerError(code, server);
    // TV: the remote stays on the card's buttons until it goes.
    const cardRef = useRef<HostInstance>(null);
    useTvFocusScope(cardRef, true);
    return (
        <View style={styles.wrap} pointerEvents="box-none">
            <View ref={cardRef} collapsable={false} style={styles.card} accessibilityRole="alert">
                <Feather name="alert-circle" size={28} color={colors.text} />
                <Text style={[type.heading, styles.title]}>{title}</Text>
                <Text style={[type.body, styles.body]}>{body}</Text>
                <Text style={[type.caption, styles.code]} selectable={!IS_TV}>{code}</Text>
                <View style={styles.actions}>
                    <Button label="Close" onPress={onClose} onPlayer />
                    {onNext && <Button label="Next video" onPress={onNext} onPlayer />}
                    {/LOCAL_NETWORK_DENIED/.test(code) && <Button label="Open settings" onPress={() => Linking.openSettings()} onPlayer />}
                    <Button label="Retry" variant="primary" icon="rotate-cw" onPress={onRetry} onPlayer />
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    // Above PlayerControls (10), whose centre buttons otherwise draw over the card.
    wrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: metrics.gutter, zIndex: 50, elevation: 10 },
    card: {
        width: '100%',
        maxWidth: 420,
        alignItems: 'center',
        gap: metrics.space.sm,
        padding: metrics.space.xl,
        borderRadius: metrics.radius.card,
        backgroundColor: colors.cardElevated,
    },
    title: { color: colors.text, textAlign: 'center' },
    body: { color: colors.textSecondary, textAlign: 'center' },
    code: { color: colors.textTertiary, textAlign: 'center' },
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: metrics.space.sm, marginTop: metrics.space.md },
});
