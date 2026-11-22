// components/VideoPlayer/ChapterPanel.tsx
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, type ScrollViewInstance } from 'react-native';
import { useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Touchable } from '@/components/ui';
import { useThumbnail } from '@/hooks/useThumbnails';
import { metrics, playerTheme, TV_SCALE, type } from '@/theme/theme';
import { chapterIndexAt, type Chapter } from '@/utils/chapters';
import { SidePanel } from './SidePanel';

const { colors } = playerTheme;

/** Fixed, so opening can scroll straight to the playing chapter without measuring. */
const ROW_HEIGHT = 64 * TV_SCALE;

interface ChapterPanelProps {
    visible: boolean;
    chapters: Chapter[];
    /** Highlighting reads this on the UI thread, so progress never renders the screen. */
    currentTime: SharedValue<number>;
    /** A local file gets a frame per row; streams pass nothing (a frame would fetch the film). */
    thumbnailPath?: string;
    onClose: () => void;
    onBack?: () => void;
    onSeek: (seconds: number) => void;
    formatTime: (seconds: number) => string;
}

const ChapterRow = memo<{
    chapter: Chapter;
    index: number;
    isActive: boolean;
    thumbnailPath?: string;
    onSelect: (seconds: number) => void;
    formatTime: (seconds: number) => string;
}>(({ chapter, index, isActive, thumbnailPath, onSelect, formatTime }) => {
    // A second in: chapters often open on a black frame.
    const { thumbnail } = useThumbnail(thumbnailPath, Math.round(chapter.start * 1000) + 1000);
    const time = formatTime(chapter.start);
    return (
        <Touchable
            onPress={() => onSelect(chapter.start)}
            scaleTo={1}
            stateLayer
            onPlayer
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel={`Chapter ${index + 1}, ${chapter.title}, ${time}`}
            accessibilityState={{ selected: isActive }}
        >
            {thumbnailPath !== undefined && (
                <View style={styles.thumb}>
                    {!!thumbnail && <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFill} />}
                </View>
            )}
            <View style={styles.text}>
                <Text style={[styles.title, isActive && styles.active]} numberOfLines={1}>{chapter.title}</Text>
                <Text style={styles.time}>{time}</Text>
            </View>
        </Touchable>
    );
});

ChapterRow.displayName = 'ChapterRow';

export const ChapterPanel: React.FC<ChapterPanelProps> = memo(({
    visible, chapters, currentTime, thumbnailPath, onClose, onBack, onSeek, formatTime,
}) => {
    // Only crossing into another chapter renders, and only while the panel is open.
    const [activeIndex, setActiveIndex] = useState(-1);
    useAnimatedReaction(
        () => (visible ? chapterIndexAt(chapters, currentTime.value) : -1),
        (index, previous) => {
            if (index !== previous) {runOnJS(setActiveIndex)(index);}
        }, [visible, chapters]);

    // Rows (and their frame requests) wait for the first open, then stay.
    const [opened, setOpened] = useState(visible);
    if (visible && !opened) { setOpened(true); }

    // Open on the playing chapter, one row of context above it.
    const scrollRef = useRef<ScrollViewInstance>(null);
    useEffect(() => {
        if (!visible) {return;}
        const index = chapterIndexAt(chapters, currentTime.value);
        scrollRef.current?.scrollTo({ y: Math.max(0, (index - 1) * ROW_HEIGHT), animated: false });
    }, [visible, chapters, currentTime]);

    const handleSelect = useCallback((seconds: number) => {
        onSeek(seconds);
        onClose();
    }, [onSeek, onClose]);

    return (
        <SidePanel visible={visible} title={`Chapters · ${chapters.length}`} onClose={onClose} onBack={onBack}>
            <ScrollView
                ref={scrollRef}
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {opened && chapters.map((chapter, i) => (
                    <ChapterRow
                        key={`${chapter.start}`}
                        chapter={chapter}
                        index={i}
                        isActive={i === activeIndex}
                        thumbnailPath={thumbnailPath}
                        onSelect={handleSelect}
                        formatTime={formatTime}
                    />
                ))}
            </ScrollView>
        </SidePanel>
    );
});

ChapterPanel.displayName = 'ChapterPanel';

const styles = StyleSheet.create({
    scrollView: { flex: 1 },
    scrollContent: { paddingBottom: metrics.space.xl },
    row: {
        height: ROW_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.md,
        paddingHorizontal: metrics.space.xs,
        borderRadius: metrics.radius.md,
    },
    thumb: {
        width: 80,
        height: 45,
        borderRadius: metrics.radius.sm,
        backgroundColor: colors.fill,
        overflow: 'hidden',
    },
    text: { flex: 1, gap: 2 },
    title: { ...type.row, color: colors.text },
    active: { color: colors.primary },
    time: { ...type.caption, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
});
