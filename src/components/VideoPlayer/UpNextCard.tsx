import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { prettyTitle } from '@/components/VideoRow';
import { metrics, playerTheme, type } from '@/theme/theme';

const { colors } = playerTheme;

interface Props {
    name: string;
    /** When autoplay will start it; null = no countdown (autoplay off). */
    endsAt: number | null;
    /** Both absent while the screen is locked: the card informs, it can't be acted on. */
    onPlay?: () => void;
    onDismiss?: () => void;
    /** Insets (and controls) to clear; the card adds its own margin. */
    bottom: number;
    right: number;
}

/** Shown once a video ends and the folder has another. The screen owns the timer that plays it. */
export function UpNextCard({ name, endsAt, onPlay, onDismiss, bottom, right }: Props) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        if (endsAt === null) { return; }
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [endsAt]);

    const { title, detail } = prettyTitle(name);
    const heading = endsAt === null ? 'Up next' : `Up next in ${Math.max(0, Math.ceil((endsAt - now) / 1000))}`;
    return (
        <View style={[styles.card, { bottom: bottom + metrics.space.lg, right: right + metrics.gutter }]}>
            <Text style={[type.caption, styles.heading]}>{heading}</Text>
            <Text style={[type.body, styles.title]} numberOfLines={2}>{title}</Text>
            {detail ? <Text style={[type.caption, styles.detail]} numberOfLines={1}>{detail}</Text> : null}
            {onPlay && onDismiss && (
                <View style={styles.actions}>
                    <Button label={endsAt === null ? 'Close' : 'Cancel'} onPress={onDismiss} onPlayer />
                    <Button label="Play now" variant="primary" icon="play" onPress={onPlay} onPlayer />
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        position: 'absolute',
        width: 300,
        maxWidth: '80%',
        gap: metrics.space.xs,
        padding: metrics.space.lg,
        borderRadius: metrics.radius.card,
        backgroundColor: colors.cardElevated,
    },
    heading: { color: colors.textSecondary },
    title: { color: colors.text },
    detail: { color: colors.textTertiary },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: metrics.space.sm, marginTop: metrics.space.sm },
});
