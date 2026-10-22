// components/Loader.tsx
import React from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { metrics, type } from '@/theme/theme';

interface LoaderProps {
    size?: 'small' | 'medium' | 'large';
    text?: string;
    /** Fill and centre in the parent on the page background. Pass false for an inline spinner. */
    fullScreen?: boolean;
}

export function Loader({ size = 'medium', text, fullScreen = true }: LoaderProps) {
    const { colors } = useTheme();

    return (
        <View
            style={fullScreen ? [styles.fullScreen, { backgroundColor: colors.background }] : styles.inline}
            accessibilityRole="progressbar"
            accessibilityLabel={text ?? 'Loading'}
        >
            <ActivityIndicator size={size === 'large' ? 'large' : 'small'} color={colors.primary} />
            {text && (
                <Text style={[size === 'large' ? type.body : type.caption, styles.text, { color: colors.textSecondary }]}>
                    {text}
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    fullScreen: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: metrics.space.md,
    },
    inline: {
        justifyContent: 'center',
        alignItems: 'center',
        gap: metrics.space.md,
        padding: metrics.space.lg,
    },
    text: {
        textAlign: 'center',
    },
});
