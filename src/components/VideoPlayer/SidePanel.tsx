// components/VideoPlayer/SidePanel.tsx
import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SHEET_EXIT_MS, SheetHeader } from '@/components/ui';
import { PLAYER_BACKDROP, playerColors } from '@/theme/colors';
import { metrics, motion } from '@/theme/theme';

/**
 * The open panel's back arrow, for the player screen's hardware Back: it steps back a page
 * (a Playback sub-page, Search options, a panel opened from Playback) before closing anything.
 */
export const PanelBackContext = createContext<React.RefObject<(() => void) | null> | null>(null);

interface SidePanelProps {
    visible: boolean;
    title: string;
    onClose: () => void;
    /** A page inside a flow: chevron back before the title. */
    onBack?: () => void;
    children: React.ReactNode;
}

/**
 * The container every player panel shares. Landscape: a card springing in from the right
 * edge over the video. Portrait: a bottom sheet; drag the handle or header down to dismiss.
 * One view in both, placed by style, so a rotation re-lays it out instead of rebuilding it.
 * Always mounted by its callers, so it can animate out. Children fill the body and own their
 * scrolling. Back is the player screen's; it reaches `onBack` through PanelBackContext.
 */
export function SidePanel({ visible, title, onClose, onBack, children }: SidePanelProps) {
    const insets = useSafeAreaInsets();
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const landscape = windowWidth > windowHeight;
    const panelWidth = Math.min(360, windowWidth * 0.4) + insets.right;
    const sheetWidth = Math.min(windowWidth, 640);

    // 0 hidden, 1 open. Dragging the sheet moves it too, so the scrim follows the finger.
    const progress = useSharedValue(0);
    // How far `progress` 0 moves the panel: its width, or the sheet's measured height.
    const travel = useSharedValue(landscape ? panelWidth : windowHeight);
    useEffect(() => {
        if (landscape) { travel.value = panelWidth; }
    }, [landscape, panelWidth, travel]);

    useEffect(() => {
        progress.value = visible
            ? withSpring(1, motion.spatial)
            : withTiming(0, { duration: SHEET_EXIT_MS });
    }, [visible, progress]);

    const backRef = useContext(PanelBackContext);
    useEffect(() => {
        if (!backRef || !visible || !onBack) { return; }
        backRef.current = onBack;
        return () => { if (backRef.current === onBack) { backRef.current = null; } };
    }, [backRef, visible, onBack]);

    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const drag = useMemo(() => {
        const close = () => onCloseRef.current();
        return Gesture.Pan()
            .enabled(!landscape)
            .activeOffsetY(8)
            .onUpdate(e => {
                progress.value = Math.min(1, 1 - e.translationY / travel.value);
            })
            .onEnd(e => {
                if (e.translationY > travel.value * 0.3 || e.velocityY > 900) {
                    runOnJS(close)();
                } else {
                    progress.value = withSpring(1, motion.spatial);
                }
            });
    }, [landscape, progress, travel]);

    const panelStyle = useAnimatedStyle(() => {
        const offset = (1 - progress.value) * travel.value;
        return {
            // Hidden outright when closed: a fresh rotation has not measured the new travel yet.
            opacity: progress.value === 0 ? 0 : 1,
            transform: landscape ? [{ translateX: offset }] : [{ translateY: offset }],
        };
    }, [landscape]);
    const backdropStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, progress.value) }));

    return (
        <>
            <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents={visible ? 'auto' : 'none'}>
                <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel={`Close ${title.toLowerCase()}`}
                />
            </Animated.View>

            <Animated.View
                onLayout={landscape ? undefined : e => { travel.value = e.nativeEvent.layout.height; }}
                // Every key set in both orientations: a key one of them dropped would keep its
                // value from before the rotation (a portrait height in a landscape panel).
                style={[
                    styles.panel,
                    landscape
                        ? {
                            ...styles.side,
                            width: panelWidth,
                            left: windowWidth - panelWidth,
                            maxHeight: windowHeight,
                            paddingTop: insets.top + metrics.space.md,
                            paddingRight: insets.right,
                        }
                        : {
                            ...styles.sheet,
                            width: sheetWidth,
                            left: (windowWidth - sheetWidth) / 2,
                            maxHeight: windowHeight * 0.9,
                            ...styles.sheetPadding,
                        },
                    panelStyle,
                ]}
                pointerEvents={visible ? 'auto' : 'none'}
                accessibilityViewIsModal={visible}
            >
                <GestureDetector gesture={drag}>
                    <View style={landscape ? styles.header : styles.sheetGrip}>
                        {!landscape && <View style={styles.handle} />}
                        <SheetHeader title={title} onBack={onBack} onClose={onClose} onPlayer />
                    </View>
                </GestureDetector>
                <View
                    style={[
                        styles.body,
                        landscape
                            ? [styles.sideBody, { paddingBottom: insets.bottom }]
                            : [styles.sheetBody, { height: windowHeight * 0.6, marginBottom: Math.max(insets.bottom, metrics.space.lg) }],
                    ]}
                >
                    {children}
                </View>
            </Animated.View>
        </>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        ...StyleSheet.absoluteFill,
        backgroundColor: PLAYER_BACKDROP,
        zIndex: 100,
    },
    panel: { position: 'absolute', zIndex: 101 },
    side: {
        top: 0,
        bottom: 0,
        backgroundColor: playerColors.card,
        borderTopLeftRadius: metrics.radius.lg,
        borderTopRightRadius: 0,
        borderBottomLeftRadius: metrics.radius.lg,
    },
    sheet: {
        top: 'auto',
        bottom: 0,
        backgroundColor: playerColors.cardElevated,
        borderTopLeftRadius: metrics.radius.sheet,
        borderTopRightRadius: metrics.radius.sheet,
        borderBottomLeftRadius: 0,
    },
    sheetPadding: { paddingTop: 0, paddingRight: 0 },
    sideBody: { flex: 1, height: 'auto', marginBottom: 0 },
    sheetBody: { flex: 0, paddingBottom: 0 },
    header: { paddingHorizontal: metrics.gutter, paddingBottom: metrics.space.sm },
    sheetGrip: { paddingHorizontal: metrics.gutter, paddingTop: metrics.space.sm, paddingBottom: metrics.space.xs },
    handle: {
        width: 32,
        height: 4,
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: metrics.space.sm,
        backgroundColor: playerColors.fillStrong,
    },
    body: { paddingHorizontal: metrics.gutter },
});
