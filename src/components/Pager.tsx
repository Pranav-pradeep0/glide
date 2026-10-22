import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import PagerView, {
    PageScrollStateChangedNativeEvent,
    PagerViewOnPageScrollEvent,
    PagerViewOnPageScrollEventData,
    PagerViewOnPageSelectedEvent,
} from 'react-native-pager-view';
import Animated, { SharedValue, useEvent } from 'react-native-reanimated';

const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);

interface PagerProps {
    /** The page shown. Changing it moves the pager there (a chip or segment tap). */
    index: number;
    /** A swipe settled on another page. */
    onIndexChange: (index: number) => void;
    /** One render function per page. A page is built the first time it is reached, or a swipe heads its way. */
    pages: (() => React.ReactNode)[];
    /** Fractional page under the finger (1.5 is halfway from the second to the third), for an indicator to follow. */
    position?: SharedValue<number>;
    scrollEnabled?: boolean;
}

/** Swipeable sub-tabs. Pages stay mounted once built, so each keeps its scroll position. */
export function Pager({ index, onIndexChange, pages, position, scrollEnabled = true }: PagerProps) {
    const ref = useRef<PagerView>(null);
    // The page the native pager is on, or on its way to.
    const current = useRef(index);
    const [built, setBuilt] = useState(() => new Set([index]));
    const build = useCallback((...pageIndexes: number[]) => {
        setBuilt(prev => (pageIndexes.every(i => prev.has(i)) ? prev : new Set([...prev, ...pageIndexes])));
    }, []);

    useEffect(() => {
        if (index === current.current) { return; }
        build(index);
        // A neighbour slides in; a page further off is jumped to, so the ones between aren't built just to fly past.
        if (Math.abs(index - current.current) === 1) {
            ref.current?.setPage(index);
        } else {
            ref.current?.setPageWithoutAnimation(index);
        }
        current.current = index;
    }, [index, build]);

    const onPageScroll = useEvent<PagerViewOnPageScrollEventData>(e => {
        'worklet';
        if (position) { position.value = e.position + e.offset; }
    }, ['onPageScroll']);

    return (
        <AnimatedPagerView
            ref={ref}
            style={styles.pager}
            initialPage={index}
            scrollEnabled={scrollEnabled}
            onPageScroll={onPageScroll as unknown as (e: PagerViewOnPageScrollEvent) => void}
            onPageScrollStateChanged={(e: PageScrollStateChangedNativeEvent) => {
                if (e.nativeEvent.pageScrollState === 'dragging') {
                    build(...[current.current - 1, current.current + 1].filter(i => i >= 0 && i < pages.length));
                }
            }}
            onPageSelected={(e: PagerViewOnPageSelectedEvent) => {
                const page = e.nativeEvent.position;
                current.current = page;
                build(page);
                onIndexChange(page);
            }}
        >
            {pages.map((render, i) => (
                <View key={i} style={styles.pager} collapsable={false}>
                    {built.has(i) && render()}
                </View>
            ))}
        </AnimatedPagerView>
    );
}

const styles = StyleSheet.create({
    pager: { flex: 1 },
});
