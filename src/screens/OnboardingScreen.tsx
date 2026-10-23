import React, {
    useState,
    useRef,
    useCallback,
    useEffect,
    useMemo,
} from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    useWindowDimensions,
    Pressable,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    type LayoutChangeEvent,
} from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    cancelAnimation,
    Easing,
} from 'react-native-reanimated';

import { useAppStore } from '../store/appStore';
import { useTheme } from '../hooks/useTheme';
import PlaybackIcon from '../components/onboarding/PlaybackIcon';
import FeatureShowcaseIcon from '../components/onboarding/FeatureShowcaseIcon';
import PrivacyIcon from '../components/onboarding/PrivacyIcon';
import { IS_TV } from '../utils/tv';

// ─── Constants ────────────────────────────────────────────────────────────────
const BTN_H = 52;
const BTN_RADIUS = 16;
const GAP = 10;
const FOOTER_PAD = 28;
const FOOTER_HEIGHT = 8 + 16 + BTN_H + 48;

const TOTAL = 3;
const LAST = TOTAL - 1;
const ICON_FRAME_W = 340;
const ICON_FRAME_H = 200;
/** TV overscan: keep the buttons off the bottom edge (Android TV's 5%, 27 dp). */
const TV_FOOTER_PAD = 27;

// ─── Worklet helpers ──────────────────────────────────────────────────────────
function clamp01(t: number): number {
    'worklet';
    return t < 0 ? 0 : t > 1 ? 1 : t;
}

function phaseT(p: number, start: number, end: number): number {
    'worklet';
    return clamp01((p - start) / (end - start));
}

function easeInOut(t: number): number {
    'worklet';
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function easeOutQuart(t: number): number {
    'worklet';
    return 1 - Math.pow(1 - t, 4);
}

function easeOutCubic(t: number): number {
    'worklet';
    return 1 - Math.pow(1 - t, 3);
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface SlideData {
    id: string;
    title: string;
    tagline: string;
    bullets: string[];
}

const SLIDES: SlideData[] = [
    {
        id: '1',
        title: 'Simple & Fast',
        tagline: 'Easy controls and quick settings.',
        bullets: [
            // A TV has a remote, not gestures.
            ...(IS_TV ? [] : ['Smooth gesture controls']),
            'Customizable subtitles',
            'Fast and responsive',
        ],
    },
    {
        id: '2',
        title: 'Watch Better.',
        tagline: 'Experimental features for a better viewing experience.',
        bullets: [
            // Not on TV: it costs picture quality there (docs/android-tv.md).
            ...(IS_TV ? [] : ['Color enhancement']),
            // TV has no haptics either.
            ...(IS_TV ? [] : ['Haptic movie playback']),
            'Automatic subtitle sync',
        ],
    },
    {
        id: '3',
        title: 'Safe and Private',
        // TV is videos only for now.
        tagline: IS_TV ? 'Your videos stay yours.' : 'Your videos and music stay yours.',
        bullets: [
            // Not "no analytics": Stallion sends crash reports, and subtitle and lyrics
            // lookups send titles. The privacy policy (Settings > About) lists them.
            'No accounts, no ads, free forever',
            IS_TV ? 'Your videos never leave your TV' : 'Your videos and music never leave your phone',
        ],
    },
];

// ─── SlideItem ────────────────────────────────────────────────────────────────
interface SlideItemProps {
    item: SlideData;
    isActive: boolean;
    shouldAnimate: boolean;
    keepMounted: boolean;
    slideWidth: number;
    contentTopPadding: number;
    activeFeatureIndex: number;
    onFeatureActivate?: (index: number) => void;
    themeColors: {
        text: string;
        textSecondary: string;
        background: string;
        border: string;
        primary: string;
    };
}

const SlideItem = React.memo<SlideItemProps>(
    ({
        item,
        isActive,
        shouldAnimate,
        keepMounted,
        slideWidth,
        contentTopPadding,
        activeFeatureIndex,
        onFeatureActivate,
        themeColors,
    }) => {
        const [animateReady, setAnimateReady] = useState(false);

        useEffect(() => {
            if (!isActive || !shouldAnimate) {
                setAnimateReady(false);
                return;
            }
            const handle = requestIdleCallback(() => setAnimateReady(true));
            return () => {
                cancelIdleCallback(handle);
                setAnimateReady(false);
            };
        }, [isActive, shouldAnimate]);

        const animate = isActive && shouldAnimate && animateReady;
        const stormAnimate = isActive && shouldAnimate;

        const iconElement = useMemo(() => {
            const p = {
                color: themeColors.text,
                secondaryColor: themeColors.textSecondary,
            };
            switch (item.id) {
                case '1': return <PlaybackIcon {...p} animate={animate} />;
                case '2': return <FeatureShowcaseIcon {...p} animate={stormAnimate} onFeatureActivate={onFeatureActivate} />;
                case '3': return <PrivacyIcon {...p} animate={animate} />;
                default: return null;
            }
        }, [item.id, animate, stormAnimate, themeColors.text, themeColors.textSecondary, onFeatureActivate]);

        return (
            <View style={[slideStyles.slide, { width: slideWidth }]}>
                <View style={[slideStyles.content, { paddingTop: contentTopPadding }]}>
                    <View style={slideStyles.iconContainer}>
                        {keepMounted
                            ? iconElement
                            : <View style={slideStyles.iconPlaceholder} />
                        }
                    </View>
                    <View style={slideStyles.titleWrap}>
                        <Text style={[slideStyles.title, { color: themeColors.text }]}>
                            {item.title}
                        </Text>
                    </View>
                    <View style={slideStyles.taglineWrap}>
                        <Text style={[slideStyles.tagline, { color: themeColors.textSecondary }]}>
                            {item.tagline}
                        </Text>
                    </View>
                    <View style={[slideStyles.bulletsContainer, IS_TV && slideStyles.bulletsTv]}>
                        {item.bullets.map((bullet, i) => {
                            const isSlide2 = item.id === '2';
                            const highlighted = isSlide2 && i <= activeFeatureIndex;
                            return (
                                <View key={i} style={slideStyles.bulletRow}>
                                    <View
                                        style={[
                                            slideStyles.bulletDot,
                                            {
                                                backgroundColor: highlighted
                                                    ? themeColors.primary
                                                    : themeColors.textSecondary,
                                            },
                                        ]}
                                    />
                                    <Text
                                        style={[
                                            slideStyles.bulletText,
                                            {
                                                color: themeColors.text,
                                                opacity: isSlide2 ? (highlighted ? 1 : 0.4) : 1,
                                            },
                                        ]}
                                    >
                                        {bullet}
                                    </Text>
                                </View>
                            );
                        })}
                    </View>
                </View>
            </View>
        );
    },
    (prev, next) =>
        prev.isActive === next.isActive &&
        prev.shouldAnimate === next.shouldAnimate &&
        prev.keepMounted === next.keepMounted &&
        prev.slideWidth === next.slideWidth &&
        prev.contentTopPadding === next.contentTopPadding &&
        prev.item.id === next.item.id &&
        prev.activeFeatureIndex === next.activeFeatureIndex &&
        prev.themeColors === next.themeColors,
);
SlideItem.displayName = 'SlideItem';

// ─── Pagination ───────────────────────────────────────────────────────────────
interface PaginationProps {
    total: number;
    currentIndex: number;
    activeColor: string;
    inactiveColor: string;
}

const Pagination = React.memo<PaginationProps>(({
    total,
    currentIndex,
    activeColor,
    inactiveColor,
}) => (
    <View style={paginationStyles.row}>
        {Array.from({ length: total }).map((_, i) => (
            <View
                key={i}
                style={[
                    paginationStyles.dot,
                    {
                        width: i === currentIndex ? 24 : 8,
                        backgroundColor: i === currentIndex ? activeColor : inactiveColor,
                    },
                ]}
            />
        ))}
    </View>
));
Pagination.displayName = 'Pagination';

// ─── MergingCTA ───────────────────────────────────────────────────────────────
interface MergingCTAProps {
    isLastSlide: boolean;
    onNext: () => void;
    onSkip: () => void;
    primaryColor: string;
    backgroundColor: string;
    textColor: string;
    borderColor: string;
    dark: boolean;
}

const MergingCTA = React.memo<MergingCTAProps>(({
    isLastSlide,
    onNext,
    onSkip,
    primaryColor,
    backgroundColor,
    textColor,
    borderColor,
    dark,
}) => {
    const [containerW, setContainerW] = useState(0);
    const containerWsv = useSharedValue(0);

    const btnTextColor = dark ? backgroundColor : '#FFFFFF';

    const progress = useSharedValue(0);

    useEffect(() => {
        if (!isLastSlide) {
            cancelAnimation(progress);
            progress.value = 0;
            return;
        }
        progress.value = withTiming(1, { duration: 680, easing: Easing.linear });
    }, [isLastSlide]);

    const skipStyle = useAnimatedStyle(() => {
        const cw = containerWsv.value;
        if (!cw) { return { opacity: 0 }; }

        const bw = (cw - GAP) / 2;
        const t = easeInOut(phaseT(progress.value, 0, 0.55));
        const half = bw / 2 + GAP / 2;

        return {
            transform: [{ translateX: t * half }],
            opacity: 1 - t,
        };
    });

    const nextStyle = useAnimatedStyle(() => {
        const cw = containerWsv.value;
        if (!cw) { return { opacity: 0 }; }

        const bw = (cw - GAP) / 2;
        const t = easeInOut(phaseT(progress.value, 0, 0.55));
        const half = bw / 2 + GAP / 2;

        return {
            transform: [{ translateX: -(t * half) }],
            opacity: 1 - t,
        };
    });

    const pillStyle = useAnimatedStyle(() => {
        const cw = containerWsv.value;
        if (!cw) { return { opacity: 0 }; }

        const bw = (cw - GAP) / 2;
        const expand = easeOutQuart(phaseT(progress.value, 0.32, 0.82));
        const fadeIn = phaseT(progress.value, 0.30, 0.50);

        return {
            width: bw + expand * (cw - bw),
            borderRadius: BTN_RADIUS + expand * (BTN_H / 2 - BTN_RADIUS),
            opacity: fadeIn,
        };
    });

    const labelStyle = useAnimatedStyle(() => {
        const t = easeOutCubic(phaseT(progress.value, 0.74, 1.0));
        return {
            opacity: t,
            transform: [{ translateY: (1 - t) * 6 }],
        };
    });

    const onLayout = useCallback((e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        setContainerW(w);
        containerWsv.value = w;
    }, []);

    const btnW = containerW > 0 ? (containerW - GAP) / 2 : 0;

    return (
        <View style={ctaStyles.row} onLayout={onLayout}>
            {containerW > 0 && (
                <>
                    <Animated.View
                        style={[
                            ctaStyles.btnWrapper,
                            { width: btnW, borderRadius: BTN_RADIUS },
                            skipStyle,
                        ]}
                    >
                        <Pressable
                            onPress={onSkip}
                            style={({ pressed }) => [
                                ctaStyles.btn,
                                {
                                    borderColor,
                                    borderWidth: 1.5,
                                    backgroundColor: 'transparent',
                                },
                                pressed && ctaStyles.btnPressed,
                            ]}
                            android_ripple={{ color: borderColor, borderless: false }}
                        >
                            <Text style={[ctaStyles.label, { color: textColor, opacity: 0.55 }]}>
                                Skip
                            </Text>
                        </Pressable>
                    </Animated.View>

                    <Animated.View
                        style={[
                            ctaStyles.btnWrapper,
                            { width: btnW, borderRadius: BTN_RADIUS },
                            nextStyle,
                        ]}
                    >
                        <Pressable
                            onPress={onNext}
                            style={({ pressed }) => [
                                ctaStyles.btn,
                                { backgroundColor: primaryColor },
                                pressed && ctaStyles.btnPressed,
                            ]}
                            android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: false }}
                        >
                            <Text style={[ctaStyles.label, { color: btnTextColor }]}>Next</Text>
                        </Pressable>
                    </Animated.View>

                    <Animated.View
                        pointerEvents={isLastSlide ? 'auto' : 'none'}
                        style={[
                            ctaStyles.pill,
                            { backgroundColor: primaryColor, height: BTN_H },
                            pillStyle,
                        ]}
                    >
                        <Pressable
                            onPress={onNext}
                            style={({ pressed }) => [
                                ctaStyles.pillInner,
                                pressed && ctaStyles.btnPressed,
                            ]}
                            android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: false }}
                        >
                            <Animated.Text
                                style={[ctaStyles.label, { color: btnTextColor }, labelStyle]}
                                numberOfLines={1}
                            >
                                Get Started
                            </Animated.Text>
                        </Pressable>
                    </Animated.View>
                </>
            )}
        </View>
    );
},
    (prev, next) =>
        prev.isLastSlide === next.isLastSlide &&
        prev.primaryColor === next.primaryColor &&
        prev.backgroundColor === next.backgroundColor &&
        prev.textColor === next.textColor &&
        prev.borderColor === next.borderColor &&
        prev.dark === next.dark,
);
MergingCTA.displayName = 'MergingCTA';

// ─── TvCTA ────────────────────────────────────────────────────────────────────
interface TvCTAProps {
    isLastSlide: boolean;
    onNext: () => void;
    onSkip: () => void;
    primaryColor: string;
    onPrimaryColor: string;
    textColor: string;
    borderColor: string;
}

/**
 * TV: plain buttons for the remote. MergingCTA keeps faded-out buttons mounted, which D-pad
 * focus would still land on. Next stays the same view through to Get Started, so focus stays put.
 * Next comes first in the tree (drawn on the right by row-reverse), so Android's default focus
 * also picks it if hasTVPreferredFocus fires before the view is attached.
 */
function TvCTA({ isLastSlide, onNext, onSkip, primaryColor, onPrimaryColor, textColor, borderColor }: TvCTAProps) {
    return (
        <View style={ctaStyles.tvRow}>
            <TvButton
                label={isLastSlide ? 'Get Started' : 'Next'}
                onPress={onNext}
                fill={primaryColor}
                color={onPrimaryColor}
                edge={primaryColor}
                ring={textColor}
                preferred
            />
            {!isLastSlide && (
                <TvButton label="Skip" onPress={onSkip} fill="transparent" color={textColor} edge={borderColor} ring={textColor} />
            )}
        </View>
    );
}

function TvButton({ label, onPress, fill, color, edge, ring, preferred }: {
    label: string; onPress: () => void; fill: string; color: string; edge: string; ring: string; preferred?: boolean;
}) {
    const [focused, setFocused] = useState(false);
    return (
        <Pressable
            onPress={onPress}
            hasTVPreferredFocus={preferred}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            accessibilityRole="button"
            style={[ctaStyles.btn, ctaStyles.tvBtn, { backgroundColor: fill, borderColor: edge }, focused && [ctaStyles.tvFocused, { outlineColor: ring }]]}
        >
            <Text style={[ctaStyles.label, { color }]}>{label}</Text>
        </Pressable>
    );
}

// ─── OnboardingScreen ─────────────────────────────────────────────────────────
export default function OnboardingScreen() {
    const theme = useTheme();
    const completeOnboarding = useAppStore((state) => state.completeOnboarding);
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();

    const [currentIndex, setCurrentIndex] = useState(0);
    const [isSwiping, setIsSwiping] = useState(false);
    const [activeFeatureIndex, setActiveFeatureIndex] = useState(-1);

    const flatListRef = useRef<FlatList<SlideData>>(null);

    // ── FIX 1: Track the intended next index with a ref so handleNext always
    //    reads the latest committed position, avoiding stale closure bugs.
    //    This ref is the single source of truth for "where we are navigating to".
    const pendingIndexRef = useRef(0);

    // ── FIX 2: Guard against double-taps / rapid taps while a programmatic
    //    scroll is already in flight. Without this, two quick taps on "Next"
    //    from slide 0 would enqueue scrollToIndex(1) then scrollToIndex(2)
    //    before onMomentumScrollEnd has had a chance to update currentIndex,
    //    causing the visible jump from slide 0 → 2.
    const isScrollingRef = useRef(false);

    const responsiveContentTopPadding = useMemo(
        // A 16:9 TV is ~540 dp tall: the slide needs all of it.
        () => (IS_TV ? 0 : Math.max(56, Math.min(90, Math.round(screenHeight * 0.11)))),
        [screenHeight],
    );

    const getItemLayout = useCallback(
        (_: unknown, index: number) => ({
            length: screenWidth,
            offset: screenWidth * index,
            index,
        }),
        [screenWidth],
    );

    const handleNext = useCallback(() => {
        // Block if a programmatic scroll is already in progress.
        if (isScrollingRef.current) { return; }

        // Read the latest index directly from the ref — never from a potentially
        // stale closure over `currentIndex` state.
        const idx = pendingIndexRef.current;

        // TV shows one slide at a time, no list to scroll.
        if (IS_TV && idx < LAST) {
            pendingIndexRef.current = idx + 1;
            setCurrentIndex(idx + 1);
            return;
        }

        if (idx < LAST) {
            const nextIdx = idx + 1;
            isScrollingRef.current = true;
            // Update the ref immediately so any re-entrant call sees the new value.
            pendingIndexRef.current = nextIdx;
            setIsSwiping(true);
            flatListRef.current?.scrollToIndex({ index: nextIdx, animated: true });
        } else {
            completeOnboarding();
        }
    }, [completeOnboarding]);

    const handleSkip = useCallback(() => completeOnboarding(), [completeOnboarding]);

    // ── FIX 3: onScrollBeginDrag must also lock isScrollingRef so that a swipe
    //    gesture followed by tapping Next before momentum ends can't double-fire.
    const handleDrag = useCallback(() => {
        isScrollingRef.current = true;
        setIsSwiping(true);
    }, []);

    const handleFeatureActivate = useCallback((i: number) => setActiveFeatureIndex(i), []);

    const handleMomentumEnd = useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            const next = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
            const clamped = Math.max(0, Math.min(LAST, next));

            // Always sync the ref to the actual scroll position so subsequent
            // handleNext calls start from the correct slide.
            pendingIndexRef.current = clamped;

            setCurrentIndex(clamped);
            setIsSwiping(false);

            // Release the scroll lock only after state is queued.
            isScrollingRef.current = false;
        },
        [screenWidth],
    );

    // ── FIX 4: onScrollEndDrag handles the edge case where the user drags but
    //    doesn't generate momentum (very slow drag that snaps back). Without
    //    this, isScrollingRef could stay `true` forever, permanently blocking
    //    the Next button.
    const handleScrollEndDrag = useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            // If velocity is ~0 the list snaps without firing onMomentumScrollEnd,
            // so we must resolve state here too.
            const velocity = e.nativeEvent.velocity;
            const isEffectivelyStill =
                velocity == null ||
                (Math.abs(velocity.x ?? 0) < 0.1 && Math.abs(velocity.y ?? 0) < 0.1);

            if (isEffectivelyStill) {
                const next = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
                const clamped = Math.max(0, Math.min(LAST, next));
                pendingIndexRef.current = clamped;
                setCurrentIndex(clamped);
                setIsSwiping(false);
                isScrollingRef.current = false;
            }
        },
        [screenWidth],
    );

    const renderItem = useCallback(
        ({ item, index }: { item: SlideData; index: number }) => (
            <SlideItem
                item={item}
                isActive={index === currentIndex}
                shouldAnimate={!isSwiping}
                keepMounted={Math.abs(index - currentIndex) <= 1}
                slideWidth={screenWidth}
                contentTopPadding={responsiveContentTopPadding}
                activeFeatureIndex={activeFeatureIndex}
                onFeatureActivate={index === 1 ? handleFeatureActivate : undefined}
                themeColors={theme.colors}
            />
        ),
        [currentIndex, isSwiping, screenWidth, responsiveContentTopPadding, activeFeatureIndex, handleFeatureActivate, theme.colors],
    );

    return (
        <View style={[screenStyles.container, { backgroundColor: theme.colors.background }]}>
            {/* TV: no swiping with a remote, so the buttons step through the slides. */}
            {IS_TV ? (
                <View key={currentIndex} style={screenStyles.container}>
                    {renderItem({ item: SLIDES[currentIndex], index: currentIndex })}
                </View>
            ) : <FlatList
                ref={flatListRef}
                data={SLIDES}
                renderItem={renderItem}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={item => item.id}
                onScrollBeginDrag={handleDrag}
                onMomentumScrollEnd={handleMomentumEnd}
                onScrollEndDrag={handleScrollEndDrag}
                getItemLayout={getItemLayout}
                windowSize={3}
                initialNumToRender={2}
                maxToRenderPerBatch={2}
                removeClippedSubviews
            />}

            <View style={[screenStyles.footer, { paddingHorizontal: FOOTER_PAD }, IS_TV && screenStyles.footerTv]}>
                <Pagination
                    total={TOTAL}
                    currentIndex={currentIndex}
                    activeColor={theme.colors.text}
                    inactiveColor={theme.colors.border}
                />
                {IS_TV ? (
                    <TvCTA
                        isLastSlide={currentIndex === LAST}
                        onNext={handleNext}
                        onSkip={handleSkip}
                        primaryColor={theme.colors.primary}
                        onPrimaryColor={theme.dark ? theme.colors.background : '#FFFFFF'}
                        textColor={theme.colors.text}
                        borderColor={theme.colors.border}
                    />
                ) : <MergingCTA
                    isLastSlide={currentIndex === LAST}
                    onNext={handleNext}
                    onSkip={handleSkip}
                    primaryColor={theme.colors.primary}
                    backgroundColor={theme.colors.background}
                    textColor={theme.colors.text}
                    borderColor={theme.colors.border}
                    dark={theme.dark}
                />}
            </View>
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const slideStyles = StyleSheet.create({
    slide: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    content: { paddingHorizontal: 24, alignItems: 'center', width: '100%', maxWidth: 420 },
    iconContainer: {
        marginBottom: 18,
        width: ICON_FRAME_W,
        height: ICON_FRAME_H,
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconPlaceholder: { width: ICON_FRAME_W, height: ICON_FRAME_H },
    titleWrap: { minHeight: 62, width: '100%', justifyContent: 'center', marginBottom: 2 },
    title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center', letterSpacing: 0.3, lineHeight: 34 },
    taglineWrap: { minHeight: 40, width: '100%', justifyContent: 'center', marginBottom: 14 },
    tagline: { fontSize: 15, fontStyle: 'italic', textAlign: 'center', lineHeight: 21 },
    bulletsContainer: { width: '100%', minHeight: 118, paddingLeft: 8, marginBottom: 12 },
    bulletsTv: { minHeight: 0 },
    bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
    bulletDot: { width: 5, height: 5, borderRadius: 2.5, marginRight: 12, marginTop: 8 },
    bulletText: { fontSize: 14, lineHeight: 20 },
});

const paginationStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        height: 8,
        marginBottom: 16,
        gap: 6,
    },
    dot: { height: 8, borderRadius: 4 },
});

const ctaStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: GAP,
        height: BTN_H,
        position: 'relative',
    },
    btnWrapper: {
        overflow: 'hidden',
    },
    btn: {
        height: BTN_H,
        borderRadius: BTN_RADIUS,
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
    },
    label: {
        fontSize: 15,
        fontWeight: '600',
        letterSpacing: 0.3,
    },
    pill: {
        position: 'absolute',
        right: 0,
        top: 0,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    pillInner: {
        flex: 1,
        width: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    btnPressed: {
        opacity: 0.78,
    },
    tvRow: { flexDirection: 'row-reverse', justifyContent: 'center', gap: GAP * 2 },
    tvBtn: { width: 220, borderWidth: 3 },
    // Outline outside the edge with a gap, so it shows on the filled Next too (a border in `ring` vanished there).
    tvFocused: { transform: [{ scale: 1.06 }], outlineWidth: 3, outlineOffset: 3 },
});

const screenStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
    footer: {
        height: FOOTER_HEIGHT,
        justifyContent: 'flex-end',
        paddingBottom: 48,
    },
    footerTv: { height: FOOTER_HEIGHT - 48 + TV_FOOTER_PAD, paddingBottom: TV_FOOTER_PAD },
});
