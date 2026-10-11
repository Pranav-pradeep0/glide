import React from 'react';
import {
    StyleSheet,
    View,
    Text,
    Modal,
    Pressable,
    ScrollView,
    ActivityIndicator,
    useWindowDimensions,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Button, SheetHeader } from '@/components/ui';
import { PLAYER_BACKDROP } from '@/theme/colors';
import { metrics, motion, playerTheme, type } from '@/theme/theme';

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

export const RecapModal: React.FC<RecapModalProps> = ({
    visible,
    onClose,
    onResume,
    recapText,
    videoName,
    isLoading = false,
    loadingMessage,
}) => {
    const { width, height } = useWindowDimensions();

    if (!visible) {return null;}

    const isLandscape = width > height;
    const showLoading = isLoading || recapText === null;
    const contentWidth = isLandscape ? Math.min(width * 0.7, 600) : Math.min(width * 0.9, 500);
    const scrollMaxHeight = isLandscape ? height * 0.45 : height * 0.5;

    return (
        <Modal
            transparent
            statusBarTranslucent
            navigationBarTranslucent
            visible={visible}
            animationType="none" // We handle animation ourselves
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel="Close recap"
                />
                <Animated.View
                    entering={FadeIn.duration(motion.fadeIn)}
                    exiting={FadeOut.duration(motion.fadeOut)}
                    style={[styles.card, { width: contentWidth, maxHeight: height * 0.85 }]}
                >
                    <SheetHeader title={videoName} onClose={onClose} onPlayer />

                    {showLoading ? (
                        <View style={styles.loading} accessibilityLiveRegion="polite">
                            <ActivityIndicator size="small" color={colors.textSecondary} />
                            <Text style={styles.loadingText}>{loadingMessage ?? 'Preparing your recap…'}</Text>
                        </View>
                    ) : (
                        <ScrollView style={{ maxHeight: scrollMaxHeight }} showsVerticalScrollIndicator={false}>
                            <Animated.Text entering={FadeIn.duration(motion.fadeIn)} style={styles.recapText}>
                                {recapText}
                            </Animated.Text>
                        </ScrollView>
                    )}

                    <Button
                        label={showLoading ? 'Skip and resume' : 'Resume'}
                        variant="primary"
                        size="lg"
                        icon="play"
                        onPress={onResume}
                        onPlayer
                    />
                </Animated.View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
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
});
