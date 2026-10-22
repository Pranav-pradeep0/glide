import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View, type LayoutChangeEvent, type ViewProps } from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import Animated, {
    runOnJS,
    scrollTo,
    useAnimatedRef,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useFrameCallback,
    useSharedValue,
    withTiming,
    type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { IconButton, Touchable } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { metrics, type } from '@/theme/theme';
import { formatDuration } from '@/utils/formatUtils';
import { haptic } from '@/native/HapticModule';
import { AudioTrack } from '@/types';

export interface QueueItem {
    track: AudioTrack;
    /** Position in the queue; the list itself is in play order. */
    index: number;
}

/** Every row is this tall, which is what turns a drag distance into a slot. */
const ROW = 58;
/** Holding a row this close to the list's top or bottom edge scrolls it. */
const EDGE = 56;
const MAX_SCROLL_STEP = 12;

// Not Animated.FlatList: that one takes CellRendererComponent for its own layout animations.
const AnimatedList = Animated.createAnimatedComponent(FlatList<QueueItem>);

interface Drag {
    /** Play-order position being dragged, or -1. */
    from: SharedValue<number>;
    /** Where it would land if dropped now. */
    over: SharedValue<number>;
    fingerY: SharedValue<number>;
    scrollY: SharedValue<number>;
    scrollAtStart: SharedValue<number>;
}

interface QueueListProps {
    items: QueueItem[];
    currentIndex: number;
    accentColor: string;
    /** False while the play order isn't known yet (shuffle on, order not in from native). */
    canReorder: boolean;
    onPlay: (index: number) => void;
    onRemove: (index: number) => void;
    /** Play-order positions. */
    onMove: (from: number, to: number) => void;
}

/** The Now Playing queue: tap to play, drag the handle to reorder, x to remove. */
export function QueueList({ items, currentIndex, accentColor, canReorder, onPlay, onRemove, onMove }: QueueListProps) {
    const { colors } = useTheme();
    const listRef = useAnimatedRef<FlatList<QueueItem>>();
    const viewHeight = useSharedValue(0);
    const count = useSharedValue(items.length);
    const from = useSharedValue(-1);
    const over = useSharedValue(-1);
    const fingerY = useSharedValue(0);
    const scrollY = useSharedValue(0);
    const scrollAtStart = useSharedValue(0);
    const stableDrag: Drag = useMemo(
        () => ({ from, over, fingerY, scrollY, scrollAtStart }),
        [from, over, fingerY, scrollY, scrollAtStart],
    );

    // The new order has rendered: drop the drag offsets in the same pass, so rows don't
    // show their old shift on top of their new place.
    useLayoutEffect(() => {
        count.value = items.length;
        stableDrag.from.value = -1;
        stableDrag.over.value = -1;
    }, [items, count, stableDrag]);

    const onScroll = useAnimatedScrollHandler((e) => {
        stableDrag.scrollY.value = e.contentOffset.y;
    });

    const autoScroll = useFrameCallback(() => {
        if (from.value < 0) { return; }
        // Where the finger is in the visible list (the handle is grabbed near the row's middle).
        const y = from.value * ROW - scrollAtStart.value + ROW / 2 + fingerY.value;
        let step = 0;
        if (y < EDGE) {
            step = -MAX_SCROLL_STEP * Math.min(1, (EDGE - y) / EDGE);
        } else if (y > viewHeight.value - EDGE) {
            step = MAX_SCROLL_STEP * Math.min(1, (y - viewHeight.value + EDGE) / EDGE);
        }
        if (step === 0) { return; }
        const max = Math.max(0, count.value * ROW - viewHeight.value);
        const next = Math.min(max, Math.max(0, scrollY.value + step));
        if (next === scrollY.value) { return; }
        scrollTo(listRef, 0, next, false);
        scrollY.value = next;
        over.value = slotFor(stableDrag, count.value);
    }, false);

    const setAutoScroll = useCallback((on: boolean) => autoScroll.setActive(on), [autoScroll]);

    // Open on the current song. Not initialScrollIndex: it skips rendering the rows above it,
    // and a queue too short to scroll never fires the scroll that would fill them in.
    const [startIndex] = useState(() => items.findIndex((item) => item.index === currentIndex));
    useEffect(() => {
        if (startIndex > 0) { listRef.current?.scrollToIndex({ index: startIndex, animated: false }); }
    }, [listRef, startIndex]);

    const CellRendererComponent = useCallback(
        (props: CellProps) => <QueueCell {...props} drag={stableDrag} background={colors.cardElevated} />,
        [stableDrag, colors.cardElevated],
    );

    return (
        <View style={styles.wrap} onLayout={(e: LayoutChangeEvent) => { viewHeight.value = e.nativeEvent.layout.height; }}>
            <AnimatedList
                ref={listRef}
                data={items}
                onScroll={onScroll}
                keyExtractor={(item) => `${item.track.id}-${item.index}`}
                getItemLayout={(_, index) => ({ length: ROW, offset: ROW * index, index })}
                CellRendererComponent={CellRendererComponent}
                renderItem={({ item, index }) => (
                    <QueueRow
                        item={item}
                        position={index}
                        count={items.length}
                        isCurrent={item.index === currentIndex}
                        accentColor={accentColor}
                        canReorder={canReorder}
                        drag={stableDrag}
                        onPlay={onPlay}
                        onRemove={onRemove}
                        onMove={onMove}
                        setAutoScroll={setAutoScroll}
                    />
                )}
                initialNumToRender={15}
                maxToRenderPerBatch={10}
                windowSize={5}
                showsVerticalScrollIndicator={false}
            />
        </View>
    );
}

function slotFor(drag: Drag, count: number) {
    'worklet';
    const moved = drag.fingerY.value + drag.scrollY.value - drag.scrollAtStart.value;
    return Math.min(count - 1, Math.max(0, Math.round(drag.from.value + moved / ROW)));
}

/**
 * The cell, not the row, moves: FlatList wraps every row in one, so only a cell can sit
 * above its neighbours while dragged.
 */
type CellProps = ViewProps & { index: number; cellKey?: string; item?: QueueItem };

function QueueCell({ index, drag, background, style, children, cellKey: _key, item: _item, ...rest }: CellProps & { drag: Drag; background: string }) {
    const animated = useAnimatedStyle(() => {
        const from = drag.from.value;
        if (from < 0) {
            return { transform: [{ translateY: 0 }, { scale: 1 }], zIndex: 0, elevation: 0 };
        }
        if (from === index) {
            const y = drag.fingerY.value + drag.scrollY.value - drag.scrollAtStart.value;
            return { transform: [{ translateY: y }, { scale: 1.02 }], zIndex: 1, elevation: 8 };
        }
        const over = drag.over.value;
        const shift = from < index && index <= over ? -ROW : over <= index && index < from ? ROW : 0;
        return { transform: [{ translateY: withTiming(shift, { duration: 150 }) }, { scale: 1 }], zIndex: 0, elevation: 0 };
    });
    return (
        <Animated.View {...rest} style={[style, { backgroundColor: background, borderRadius: metrics.radius.md }, animated]}>
            {children}
        </Animated.View>
    );
}

interface QueueRowProps {
    item: QueueItem;
    position: number;
    count: number;
    isCurrent: boolean;
    accentColor: string;
    canReorder: boolean;
    drag: Drag;
    onPlay: (index: number) => void;
    onRemove: (index: number) => void;
    onMove: (from: number, to: number) => void;
    setAutoScroll: (on: boolean) => void;
}

const QueueRow = React.memo(function QueueRowBase({
    item, position, count, isCurrent, accentColor, canReorder, drag, onPlay, onRemove, onMove, setAutoScroll,
}: QueueRowProps) {
    const { colors } = useTheme();

    const pan = useMemo(() => Gesture.Pan()
        .minDistance(0)
        .onStart(() => {
            drag.fingerY.value = 0;
            drag.scrollAtStart.value = drag.scrollY.value;
            drag.over.value = position;
            drag.from.value = position;
            runOnJS(haptic)('longPress');
            runOnJS(setAutoScroll)(true);
        })
        .onUpdate((e) => {
            drag.fingerY.value = e.translationY;
            const slot = slotFor(drag, count);
            if (slot !== drag.over.value) {
                drag.over.value = slot;
                runOnJS(haptic)('segmentTick');
            }
        })
        .onEnd((_e, success) => {
            const to = drag.over.value;
            // A re-render mid-drag (the song changed) has already dropped it.
            if (success && drag.from.value === position && to !== position) {
                // Offsets stay until the new order renders (QueueList's layout effect).
                runOnJS(onMove)(position, to);
            } else {
                drag.from.value = -1;
                drag.over.value = -1;
            }
        })
        .onFinalize(() => {
            runOnJS(setAutoScroll)(false);
        }), [drag, position, count, onMove, setAutoScroll]);

    return (
        <View style={[styles.row, isCurrent && { backgroundColor: colors.primaryContainer }]}>
            <Touchable style={styles.rowMain} onPress={() => onPlay(item.index)} scaleTo={0.98}>
                <Feather name={isCurrent ? 'volume-2' : 'music'} size={18} color={isCurrent ? accentColor : colors.textTertiary} />
                <View style={styles.info}>
                    <Text
                        style={[type.row, { color: isCurrent ? accentColor : colors.text, fontWeight: isCurrent ? '700' : '400' }]}
                        numberOfLines={1}
                    >
                        {item.track.title}
                    </Text>
                    <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                        {item.track.artist} · {formatDuration(item.track.duration)}
                    </Text>
                </View>
            </Touchable>
            <IconButton
                icon="x"
                onPress={() => onRemove(item.index)}
                accessibilityLabel="Remove from queue"
                iconSize={18}
                color={colors.textTertiary}
            />
            {canReorder && (
                <GestureDetector gesture={pan}>
                    <View
                        style={styles.handle}
                        accessible
                        accessibilityLabel={`Reorder ${item.track.title}`}
                        accessibilityActions={[
                            ...(position > 0 ? [{ name: 'moveUp', label: 'Move up' }] : []),
                            ...(position < count - 1 ? [{ name: 'moveDown', label: 'Move down' }] : []),
                        ]}
                        onAccessibilityAction={(e) => {
                            onMove(position, e.nativeEvent.actionName === 'moveUp' ? position - 1 : position + 1);
                        }}
                    >
                        <Feather name="menu" size={20} color={colors.textTertiary} />
                    </View>
                </GestureDetector>
            )}
        </View>
    );
});

const styles = StyleSheet.create({
    wrap: {
        maxHeight: 420,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: metrics.gutter,
        height: ROW,
        borderRadius: metrics.radius.md,
    },
    rowMain: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.md,
        alignSelf: 'stretch',
    },
    info: {
        flex: 1,
        gap: 2,
    },
    handle: {
        width: 48,
        alignSelf: 'stretch',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
