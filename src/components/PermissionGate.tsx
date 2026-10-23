import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import { Button } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { usePermissionStore } from '@/store/permissionStore';
import { MediaKind } from '@/services/PermissionService';
import { metrics, type } from '@/theme/theme';

const COPY: Record<MediaKind, { icon: 'film' | 'music'; title: string; body: string }> = {
    video: {
        icon: 'film',
        title: 'Allow access to your videos',
        body: 'Glide needs permission to find and play the videos on this device.',
    },
    audio: {
        icon: 'music',
        title: 'Allow access to your music',
        body: 'Glide needs permission to find and play the songs on this device.',
    },
};

/**
 * What a screen shows in place of its list when Glide cannot read that kind of media.
 * Once Android will not ask again, the button goes to Settings instead.
 */
export function PermissionGate({ kind }: { kind: MediaKind }) {
    const { colors } = useTheme();
    const blocked = usePermissionStore((s) => s[kind].blocked);
    const request = usePermissionStore((s) => s.request);
    const copy = COPY[kind];
    return (
        <View style={styles.gate}>
            <Feather name={copy.icon} size={48} color={colors.textTertiary} />
            <Text style={[type.title, styles.center, { color: colors.text }]}>{copy.title}</Text>
            <Text style={[type.body, styles.center, { color: colors.textSecondary }]}>
                {blocked ? `${copy.body} Turn it on in Settings, under Permissions.` : copy.body}
            </Text>
            <Button
                label={blocked ? 'Open settings' : 'Allow access'}
                icon={blocked ? 'settings' : 'unlock'}
                variant="primary"
                preferFocus
                onPress={() => request(kind)}
            />
        </View>
    );
}

/** Android 14+ "Select videos": the list is only what was picked, and this says so. */
export function PartialAccessBanner() {
    const { colors } = useTheme();
    const partial = usePermissionStore((s) => s.video.access === 'partial');
    const request = usePermissionStore((s) => s.request);
    if (!partial) {return null;}
    return (
        <View style={[styles.banner, { backgroundColor: colors.fill }]}>
            <Feather name="eye" size={16} color={colors.textSecondary} />
            <Text style={[type.caption, styles.bannerText, { color: colors.textSecondary }]}>
                Showing only the videos you picked
            </Text>
            <Button label="Change" variant="ghost" onPress={() => request('video')} />
        </View>
    );
}

const styles = StyleSheet.create({
    gate: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: metrics.gutter * 2,
        gap: metrics.space.md,
    },
    center: { textAlign: 'center' },
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.sm,
        marginHorizontal: metrics.gutter,
        marginTop: metrics.space.sm,
        paddingLeft: metrics.space.md,
        borderRadius: metrics.radius.md,
    },
    bannerText: { flex: 1 },
});
