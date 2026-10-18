/**
 * Glide's building blocks. Every screen and the player use these, so press feedback,
 * motion and shape are the same everywhere.
 *
 *  - Touchable: the one pressable. Springs to 0.97 and lays a state layer on press.
 *  - IconButton, Button, Chip: actions. The accent (`primary`) marks one main action per surface.
 *  - ListGroup + ListRow + Switch: Android 16 style grouped rows (settings, panels).
 *  - Sheet: bottom sheet with drag-to-dismiss. SortButton opens one.
 *  - Snackbar: `showSnackbar()` + one <SnackbarHost /> per root.
 *
 * `onPlayer` switches to the always-dark player palette for overlays on video.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    Pressable,
    PressableProps,
    StyleProp,
    StyleSheet,
    LayoutChangeEvent,
    Text,
    View,
    ViewProps,
    ViewStyle,
    processColor,
    useWindowDimensions,
} from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';
import Animated, {
    FadeIn,
    makeMutable,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import Feather from '@react-native-vector-icons/feather';
import { useTheme } from '@/hooks/useTheme';
import { haptic } from '@/native/HapticModule';
import { metrics, motion, playerTheme, type, Theme } from '@/theme/theme';

export type IconName = React.ComponentProps<typeof Feather>['name'];

export function useUiTheme(onPlayer?: boolean): Theme {
    const appTheme = useTheme();
    return onPlayer ? playerTheme : appTheme;
}

// ---------------------------------------------------------------------------
// Touchable

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface TouchableProps extends Omit<PressableProps, 'style' | 'children'> {
    style?: StyleProp<ViewStyle>;
    children?: React.ReactNode;
    /** Scale while pressed; 1 turns it off (full-width rows use the state layer only). */
    scaleTo?: number;
    /** Tint laid over the content while pressed. */
    stateLayer?: boolean;
    onPlayer?: boolean;
}

/** The one pressable. Long-press gets the system long-press haptic. */
export function Touchable({
    style, children, scaleTo = motion.pressScale, stateLayer = false, onPlayer,
    onPressIn, onPressOut, onLongPress, disabled, ...rest
}: TouchableProps) {
    const { colors } = useUiTheme(onPlayer);
    const pressed = useSharedValue(0);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: 1 - (1 - scaleTo) * pressed.value }],
    }));
    const layerStyle = useAnimatedStyle(() => ({ opacity: pressed.value }));

    return (
        <AnimatedPressable
            {...rest}
            disabled={disabled}
            onPressIn={e => {
                pressed.value = withSpring(1, motion.press);
                onPressIn?.(e);
            }}
            onPressOut={e => {
                pressed.value = withSpring(0, motion.press);
                onPressOut?.(e);
            }}
            onLongPress={onLongPress && (e => {
                haptic('longPress');
                onLongPress(e);
            })}
            style={[style, animatedStyle, disabled && styles.disabled]}
        >
            {children}
            {stateLayer && (
                <Animated.View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, styles.layer, { backgroundColor: colors.pressed }, layerStyle]}
                />
            )}
        </AnimatedPressable>
    );
}

// ---------------------------------------------------------------------------
// IconButton

interface IconButtonProps {
    icon: IconName;
    onPress: () => void;
    accessibilityLabel: string;
    /** `plain` is the glyph alone; `filled` sits on a translucent circle. */
    variant?: 'plain' | 'filled';
    iconSize?: number;
    color?: string;
    disabled?: boolean;
    /** On (a toggle that is switched on): inverted glyph on a solid accent circle, like a selected Chip. */
    active?: boolean;
    onPlayer?: boolean;
    /** Accent dot on the glyph's corner: something inside wants attention (an update). */
    badge?: boolean;
    style?: StyleProp<ViewStyle>;
}

/** 40 dp visual, 48 dp target. */
export function IconButton({
    icon, onPress, accessibilityLabel, variant = 'plain', iconSize = 22, color,
    disabled, active, onPlayer, badge, style,
}: IconButtonProps) {
    const { colors } = useUiTheme(onPlayer);
    return (
        <Touchable
            onPress={onPress}
            disabled={disabled}
            hitSlop={4}
            scaleTo={0.9}
            onPlayer={onPlayer}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ disabled: !!disabled, selected: active }}
            style={[
                styles.iconButton,
                variant === 'filled' && { backgroundColor: colors.fill },
                active && { backgroundColor: colors.primary },
                style,
            ]}
        >
            <Feather name={icon} size={iconSize} color={active ? colors.onPrimary : color ?? colors.text} />
            {badge && <View style={[styles.badge, styles.iconButtonBadge, { backgroundColor: colors.primary }]} />}
        </Touchable>
    );
}

// ---------------------------------------------------------------------------
// Button

interface ButtonProps {
    label: string;
    onPress: () => void;
    /** One `primary` per surface. `destructive` is red text on a fill, not a red slab. */
    variant?: 'primary' | 'secondary' | 'destructive' | 'ghost';
    icon?: IconName;
    loading?: boolean;
    disabled?: boolean;
    /** md 40 dp, lg 48 dp. */
    size?: 'md' | 'lg';
    /** Stretch to the parent's width. */
    block?: boolean;
    onPlayer?: boolean;
    accessibilityLabel?: string;
    style?: StyleProp<ViewStyle>;
}

export function Button({
    label, onPress, variant = 'secondary', icon, loading, disabled, size = 'md', block,
    onPlayer, accessibilityLabel, style,
}: ButtonProps) {
    const { colors } = useUiTheme(onPlayer);
    const bg = variant === 'primary' ? colors.primary : variant === 'ghost' ? 'transparent' : colors.fill;
    const fg = variant === 'primary' ? colors.onPrimary
        : variant === 'destructive' ? colors.error
        : variant === 'ghost' ? colors.primary
        : colors.text;
    const height = size === 'lg' ? 48 : 40;
    return (
        <Touchable
            onPress={onPress}
            disabled={disabled || loading}
            onPlayer={onPlayer}
            hitSlop={size === 'md' ? 4 : 0}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
            style={[
                styles.button,
                { height, borderRadius: height / 2, backgroundColor: bg },
                icon && styles.buttonWithIcon,
                block && styles.block,
                style,
            ]}
        >
            {loading
                ? <ActivityIndicator size="small" color={fg} />
                : icon && <Feather name={icon} size={17} color={fg} />}
            <Text style={[type.label, { color: fg }]} numberOfLines={1}>{label}</Text>
        </Touchable>
    );
}

// ---------------------------------------------------------------------------
// Chip

interface ChipProps {
    label: string;
    selected?: boolean;
    onPress: () => void;
    icon?: IconName;
    onPlayer?: boolean;
    accessibilityLabel?: string;
    style?: StyleProp<ViewStyle>;
}

/** One option in a set. Selected is the accent pill; the rest are translucent. */
export function Chip({ label, selected, onPress, icon, onPlayer, accessibilityLabel, style }: ChipProps) {
    const { colors } = useUiTheme(onPlayer);
    const fg = selected ? colors.onPrimary : colors.text;
    return (
        <Touchable
            onPress={onPress}
            hitSlop={6}
            scaleTo={0.94}
            onPlayer={onPlayer}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={{ selected: !!selected }}
            style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.fill }, style]}
        >
            {icon && <Feather name={icon} size={14} color={fg} />}
            <Text style={[type.label, styles.chipText, { color: fg }]} numberOfLines={1}>{label}</Text>
        </Touchable>
    );
}

// ---------------------------------------------------------------------------
// Segmented

interface SegmentedProps<K extends string> {
    options: { key: K; label: string }[];
    value: K;
    onChange: (key: K) => void;
    onPlayer?: boolean;
    style?: StyleProp<ViewStyle>;
}

/** Tabs within one surface. The chosen segment is solid accent, like a selected Chip. */
export function Segmented<K extends string>({ options, value, onChange, onPlayer, style }: SegmentedProps<K>) {
    const { colors } = useUiTheme(onPlayer);
    return (
        <View style={[styles.segmented, { backgroundColor: colors.fill }, style]} accessibilityRole="tablist">
            {options.map((o) => {
                const selected = o.key === value;
                return (
                    <Touchable
                        key={o.key}
                        onPress={() => onChange(o.key)}
                        scaleTo={1}
                        onPlayer={onPlayer}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                        style={[styles.segment, selected && { backgroundColor: colors.primary }]}
                    >
                        <Text style={[type.label, { color: selected ? colors.onPrimary : colors.textSecondary }]} numberOfLines={1}>
                            {o.label}
                        </Text>
                    </Touchable>
                );
            })}
        </View>
    );
}

// ---------------------------------------------------------------------------
// Switch

interface SwitchProps {
    value: boolean;
    onValueChange: (value: boolean) => void;
    onPlayer?: boolean;
    disabled?: boolean;
    accessibilityLabel?: string;
}

/** Accent track, sprung thumb, toggle haptic. Use inside a ListRow (`toggle`) where possible. */
export function Switch({ value, onValueChange, onPlayer, disabled, accessibilityLabel }: SwitchProps) {
    const { colors } = useUiTheme(onPlayer);
    const progress = useSharedValue(value ? 1 : 0);

    useEffect(() => {
        progress.value = withSpring(value ? 1 : 0, motion.spatial);
    }, [value, progress]);

    const thumbStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: progress.value * (SWITCH.w - SWITCH.thumb - SWITCH.inset * 2) }],
    }));
    const onStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

    return (
        <Pressable
            onPress={() => {
                haptic(value ? 'toggleOff' : 'toggleOn');
                onValueChange(!value);
            }}
            disabled={disabled}
            hitSlop={10}
            accessibilityRole="switch"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ checked: value, disabled: !!disabled }}
            style={[styles.switchTrack, { backgroundColor: colors.fillStrong }, disabled && styles.disabled]}
        >
            <Animated.View style={[StyleSheet.absoluteFill, styles.switchOn, { backgroundColor: colors.primary }, onStyle]} />
            <Animated.View style={[styles.switchThumb, { backgroundColor: value ? colors.onPrimary : colors.textSecondary }, thumbStyle]} />
        </Pressable>
    );
}

const SWITCH = { w: 44, h: 26, thumb: 18, inset: 4 };

// ---------------------------------------------------------------------------
// Grouped list

/** Accent label above a ListGroup. */
export function SectionLabel({ title, onPlayer, style }: { title: string; onPlayer?: boolean; style?: StyleProp<ViewStyle> }) {
    const { colors } = useUiTheme(onPlayer);
    return (
        <View style={[styles.sectionLabel, style]}>
            <Text style={[type.label, { color: colors.primary }]} accessibilityRole="header">{title}</Text>
        </View>
    );
}

interface ListGroupProps {
    children: React.ReactNode;
    onPlayer?: boolean;
    /** Rows drawn on a fill instead of a solid surface (inside a sheet or panel). */
    inset?: boolean;
    style?: StyleProp<ViewStyle>;
}

/** Rows split by 2 dp gaps; 20 dp outer corners, 4 dp inner. Falsy children are skipped. */
export function ListGroup({ children, onPlayer, inset, style }: ListGroupProps) {
    const { colors } = useUiTheme(onPlayer);
    const rows = React.Children.toArray(children).filter(Boolean);
    const bg = inset ? colors.fill : colors.surface;
    return (
        <View style={[styles.group, style]}>
            {rows.map((row, i) => (
                <View
                    key={i}
                    style={[
                        styles.groupItem,
                        { backgroundColor: bg },
                        i === 0 && styles.groupFirst,
                        i === rows.length - 1 && styles.groupLast,
                    ]}
                >
                    {row}
                </View>
            ))}
        </View>
    );
}

interface ListRowProps {
    title: string;
    caption?: string;
    icon?: IconName;
    /** Trailing value text, e.g. "English". */
    value?: string;
    /** Trailing chevron: the row opens another page. */
    chevron?: boolean;
    /** Turns the whole row into a switch. */
    toggle?: { value: boolean; onChange: (value: boolean) => void };
    /** Trailing check in the accent: the selected option in a set. */
    selected?: boolean;
    destructive?: boolean;
    onPress?: () => void;
    onPlayer?: boolean;
    /** Anything else on the right. */
    trailing?: React.ReactNode;
    disabled?: boolean;
    /** Accent dot on the icon's corner, as on IconButton. */
    badge?: boolean;
}

export function ListRow({
    title, caption, icon, value, chevron, toggle, selected, destructive, onPress, onPlayer, trailing, disabled, badge,
}: ListRowProps) {
    const { colors } = useUiTheme(onPlayer);
    const fg = destructive ? colors.error : colors.text;
    const press = toggle
        ? () => {
            haptic(toggle.value ? 'toggleOff' : 'toggleOn');
            toggle.onChange(!toggle.value);
        }
        : onPress;
    const content = (
        <>
            {icon && (
                <View>
                    <Feather name={icon} size={20} color={destructive ? colors.error : colors.textSecondary} />
                    {badge && <View style={[styles.badge, styles.rowIconBadge, { backgroundColor: colors.primary }]} />}
                </View>
            )}
            <View style={styles.rowText}>
                <Text style={[type.row, styles.rowTitle, { color: fg }]} numberOfLines={2}>{title}</Text>
                {!!caption && <Text style={[type.caption, { color: colors.textSecondary }]}>{caption}</Text>}
            </View>
            {!!value && <Text style={[type.body, styles.rowValue, { color: colors.textSecondary }]} numberOfLines={1}>{value}</Text>}
            {trailing}
            {toggle && (
                <Switch value={toggle.value} onValueChange={toggle.onChange} onPlayer={onPlayer} disabled={disabled} accessibilityLabel={title} />
            )}
            {selected && <Feather name="check" size={20} color={colors.primary} />}
            {chevron && <Feather name="chevron-right" size={18} color={colors.textTertiary} />}
        </>
    );
    if (!press) {
        return <View style={styles.row}>{content}</View>;
    }
    return (
        <Touchable
            onPress={press}
            disabled={disabled}
            scaleTo={1}
            stateLayer
            onPlayer={onPlayer}
            accessibilityRole={toggle ? 'switch' : 'button'}
            accessibilityLabel={title}
            accessibilityHint={caption}
            accessibilityState={toggle ? { checked: toggle.value } : { selected: !!selected }}
            style={styles.row}
        >
            {content}
        </Touchable>
    );
}

// ---------------------------------------------------------------------------
// Card

interface CardProps extends ViewProps {
    onPlayer?: boolean;
    /** Inner padding; 0 for cards holding full-bleed rows. */
    padding?: number;
}

/** A plain raised surface. No border, no shadow: the step in surface colour is the lift. */
export function Card({ onPlayer, padding = metrics.space.lg, style, ...rest }: CardProps) {
    const { colors } = useUiTheme(onPlayer);
    return <View style={[styles.card, { backgroundColor: colors.surface, padding }, style]} {...rest} />;
}

// ---------------------------------------------------------------------------
// Gradient

interface GradientProps {
    /** Top to bottom. Any colour React Native takes, alpha included. */
    colors: string[];
    /** 0..1, one per colour; evenly spaced when left out. Past the last stop its colour holds. */
    locations?: number[];
    style?: StyleProp<ViewStyle>;
    pointerEvents?: ViewProps['pointerEvents'];
}

/** svg ignores a stop colour's own alpha and reads only stopOpacity, so it is split out. */
// eslint-disable-next-line no-bitwise -- the alpha byte of processColor's ARGB int
const alphaOf = (color: string) => (((processColor(color) as number) >>> 24) & 0xff) / 255;

/**
 * A vertical gradient, drawn with react-native-svg.
 *
 * Rebuilt when its box changes size: on Android a resize redraws the svg but keeps each
 * shape's path cached at the old size, so a player scrim drawn in portrait stayed
 * portrait-wide after rotating (a grey band over the left of the video). The svg itself
 * stays "100%" of the box: sized in measured dp, it rounded a fraction of a pixel short
 * and let a 1 px line of the picture underneath show along the edge.
 */
export function Gradient({ colors, locations, style, pointerEvents }: GradientProps) {
    const id = `gradient${useId().replace(/[^\w-]/g, '')}`;
    const [sizeKey, setSizeKey] = useState('');
    return (
        <View
            style={style}
            pointerEvents={pointerEvents}
            onLayout={e => {
                const { width, height } = e.nativeEvent.layout;
                setSizeKey(`${width}x${height}`);
            }}
        >
            <Svg key={sizeKey} style={StyleSheet.absoluteFill}>
                <Defs>
                    <SvgLinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                        {colors.map((color, i) => (
                            <Stop
                                key={i}
                                offset={locations?.[i] ?? i / (colors.length - 1)}
                                stopColor={color}
                                stopOpacity={alphaOf(color)}
                            />
                        ))}
                    </SvgLinearGradient>
                </Defs>
                <Rect width="100%" height="100%" fill={`url(#${id})`} />
            </Svg>
        </View>
    );
}

// ---------------------------------------------------------------------------
// SheetHeader

interface SheetHeaderProps {
    title: string;
    onClose?: () => void;
    /** A page inside a panel: chevron back before the title. */
    onBack?: () => void;
    /** Extra controls before the close button. */
    right?: React.ReactNode;
    onPlayer?: boolean;
}

export function SheetHeader({ title, onClose, onBack, right, onPlayer }: SheetHeaderProps) {
    const { colors } = useUiTheme(onPlayer);
    return (
        <View style={styles.header}>
            {onBack && (
                <IconButton icon="chevron-left" onPress={onBack} accessibilityLabel="Back" onPlayer={onPlayer} style={styles.headerBack} />
            )}
            <Text style={[type.heading, styles.headerTitle, { color: colors.text }]} numberOfLines={1} accessibilityRole="header">
                {title}
            </Text>
            <View style={styles.headerRight}>
                {right}
                {onClose && (
                    <IconButton icon="x" iconSize={20} color={colors.textSecondary} onPress={onClose} accessibilityLabel="Close" onPlayer={onPlayer} />
                )}
            </View>
        </View>
    );
}

// ---------------------------------------------------------------------------
// Sheet

interface SheetProps {
    visible: boolean;
    onClose: () => void;
    title?: string;
    onBack?: () => void;
    children: React.ReactNode;
    onPlayer?: boolean;
    /** Fraction of the window the sheet may grow to. */
    maxHeight?: number;
}

/**
 * Bottom sheet: scrim fade, spring up, drag the handle or header down to dismiss.
 * Stays mounted while animating out. 640 dp max width, centred on tablets and landscape.
 */
export function Sheet({ visible, onClose, title, onBack, children, onPlayer, maxHeight = 0.9 }: SheetProps) {
    const { colors } = useUiTheme(onPlayer);
    const insets = useSafeAreaInsets();
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();
    const sheetWidth = Math.min(windowWidth, 640);
    const [mounted, setMounted] = useState(visible);
    const offset = useSharedValue(windowHeight);
    const sheetHeight = useSharedValue(windowHeight);

    const unmount = useCallback(() => setMounted(false), []);

    useEffect(() => {
        if (visible) {
            setMounted(true);
            offset.value = withSpring(0, motion.spatial);
        } else if (mounted) {
            offset.value = withTiming(sheetHeight.value, { duration: motion.fadeOut }, done => {
                if (done) { runOnJS(unmount)(); }
            });
        }
    }, [visible, mounted, offset, sheetHeight, unmount]);

    const drag = Gesture.Pan()
        .activeOffsetY(8)
        .onUpdate(e => {
            offset.value = Math.max(0, e.translationY);
        })
        .onEnd(e => {
            if (e.translationY > sheetHeight.value * 0.3 || e.velocityY > 900) {
                runOnJS(onClose)();
            } else {
                offset.value = withSpring(0, motion.spatial);
            }
        });

    const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
    const scrimStyle = useAnimatedStyle(() => ({
        opacity: 1 - Math.min(1, offset.value / Math.max(1, sheetHeight.value)),
    }));

    if (!mounted) { return null; }

    return (
        <Modal transparent visible onRequestClose={onBack ?? onClose} statusBarTranslucent navigationBarTranslucent animationType="none">
            <GestureHandlerRootView style={styles.flex}>
                <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, scrimStyle]}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
                </Animated.View>
                <Animated.View
                    onLayout={e => { sheetHeight.value = e.nativeEvent.layout.height; }}
                    accessibilityViewIsModal
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: colors.cardElevated,
                            maxHeight: windowHeight * maxHeight,
                            width: sheetWidth,
                            left: (windowWidth - sheetWidth) / 2,
                            paddingBottom: Math.max(insets.bottom, metrics.space.lg),
                        },
                        sheetStyle,
                    ]}
                >
                    <GestureDetector gesture={drag}>
                        <View style={styles.sheetGrip}>
                            <View style={[styles.handle, { backgroundColor: colors.fillStrong }]} />
                            {!!title && <SheetHeader title={title} onBack={onBack} onClose={onClose} onPlayer={onPlayer} />}
                        </View>
                    </GestureDetector>
                    {children}
                </Animated.View>
                <SnackbarHost />
            </GestureHandlerRootView>
        </Modal>
    );
}

// ---------------------------------------------------------------------------
// SortButton

interface SortButtonProps<K extends string> {
    options: { key: K; label: string }[];
    value: K;
    onChange: (key: K) => void;
    title?: string;
    style?: StyleProp<ViewStyle>;
}

/** "Recent ▾": the current order as text; tap for a sheet of the options. */
export function SortButton<K extends string>({ options, value, onChange, title = 'Sort by', style }: SortButtonProps<K>) {
    const { colors } = useUiTheme();
    const [open, setOpen] = useState(false);
    const current = options.find(o => o.key === value)?.label ?? '';
    return (
        <>
            <Touchable
                onPress={() => setOpen(true)}
                hitSlop={10}
                scaleTo={0.94}
                accessibilityRole="button"
                accessibilityLabel={`${title}: ${current}`}
                style={[styles.sortButton, style]}
            >
                <Text style={[type.label, { color: colors.textSecondary }]}>{current}</Text>
                <Feather name="chevron-down" size={16} color={colors.textSecondary} />
            </Touchable>
            <Sheet visible={open} onClose={() => setOpen(false)} title={title}>
                <ListGroup inset style={styles.sheetBody}>
                    {options.map(o => (
                        <ListRow
                            key={o.key}
                            title={o.label}
                            selected={o.key === value}
                            onPress={() => {
                                onChange(o.key);
                                setOpen(false);
                            }}
                        />
                    ))}
                </ListGroup>
            </Sheet>
        </>
    );
}

/** @deprecated Use SortButton. Kept so unported screens still render. */
export const SortTabs = SortButton;

// ---------------------------------------------------------------------------
// Snackbar

interface SnackbarMessage {
    text: string;
    action?: string;
    onAction?: () => void;
    /** Paired haptic: `confirm` for success, `reject` for failure. */
    tone?: 'confirm' | 'reject';
}

/**
 * Newest mounted host wins, so the player and open sheets (separate Modal windows, drawn
 * over everything else) host their own above the app root's.
 */
const snackbarListeners: ((m: SnackbarMessage) => void)[] = [];

/** One message at a time, bottom of the screen, 2–5 s by length (5 s with an action); swipe or tap dismisses. */
export function showSnackbar(message: SnackbarMessage) {
    if (message.tone) { haptic(message.tone); }
    snackbarListeners[snackbarListeners.length - 1]?.(message);
}

/** Bars flush with the bottom of focused screens (tab bar, mini player); the last one counts. */
const bottomBars: { height: number }[] = [];
const bottomBarHeight = makeMutable(0);
const syncBottomBar = () => { bottomBarHeight.value = bottomBars[bottomBars.length - 1]?.height ?? 0; };

/** `onLayout` for a bar at the bottom of a screen: the app's snackbars sit above it while the screen is focused. */
export function useSnackbarClearance() {
    const focused = useIsFocused();
    const [height, setHeight] = useState(0);
    useEffect(() => {
        if (!focused) { return; }
        const bar = { height };
        bottomBars.push(bar);
        syncBottomBar();
        return () => {
            bottomBars.splice(bottomBars.indexOf(bar), 1);
            syncBottomBar();
        };
    }, [focused, height]);
    return useCallback((e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height), []);
}

/**
 * Mount once per root. `bottomOffset` clears player controls; `aboveBottomBar` (the app root)
 * clears whatever bar `useSnackbarClearance` reports.
 */
export function SnackbarHost({ bottomOffset = 0, aboveBottomBar }: { bottomOffset?: number; aboveBottomBar?: boolean }) {
    const insets = useSafeAreaInsets();
    const [message, setMessage] = useState<SnackbarMessage | null>(null);
    // The message still on its way in or up; handed on if this host goes first.
    const liveRef = useRef<SnackbarMessage | null>(null);
    const shown = useSharedValue(0);
    const swipe = useSharedValue(0);
    const snackWidth = useSharedValue(1);

    // Unmount once faded: an invisible snackbar still catches taps.
    const hide = useCallback(() => {
        liveRef.current = null;
        shown.value = withTiming(0, { duration: motion.fadeOut }, (finished) => {
            if (finished) { runOnJS(setMessage)(null); }
        });
    }, [shown]);

    const swipedAway = useCallback(() => {
        liveRef.current = null;
        shown.value = 0;
        setMessage(null);
    }, [shown]);

    // Swiped sideways past 30% of its width (or flung), it leaves that way.
    const swipeGesture = Gesture.Pan()
        .activeOffsetX([-12, 12])
        .onUpdate(e => { swipe.value = e.translationX; })
        .onEnd(e => {
            if (Math.abs(e.translationX) > snackWidth.value * 0.3 || Math.abs(e.velocityX) > 800) {
                const to = Math.sign(e.translationX || e.velocityX) * snackWidth.value * 1.2;
                swipe.value = withTiming(to, { duration: motion.fadeOut }, done => {
                    if (done) { runOnJS(swipedAway)(); }
                });
            } else {
                swipe.value = withSpring(0, motion.spatial);
            }
        });

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const listener = (m: SnackbarMessage) => {
            clearTimeout(timer);
            liveRef.current = m;
            setMessage(m);
            swipe.value = 0;
            shown.value = withSpring(1, motion.spatial);
            // Long enough to read: "Sleep timer set" 2 s, a two-line explanation ~3.5 s.
            timer = setTimeout(hide, m.action ? 5000 : Math.min(5000, Math.max(2000, m.text.length * 50)));
        };
        snackbarListeners.push(listener);
        return () => {
            clearTimeout(timer);
            snackbarListeners.splice(snackbarListeners.indexOf(listener), 1);
            // A sheet closing as it confirms something: the host underneath shows the message.
            if (liveRef.current) { snackbarListeners[snackbarListeners.length - 1]?.(liveRef.current); }
        };
    }, [shown, swipe, hide]);

    const style = useAnimatedStyle(() => ({
        opacity: shown.value * (1 - Math.min(1, Math.abs(swipe.value) / snackWidth.value)),
        bottom: Math.max(insets.bottom, aboveBottomBar ? bottomBarHeight.value : 0) + bottomOffset + metrics.space.lg,
        transform: [{ translateY: (1 - shown.value) * 24 }, { translateX: swipe.value }],
    }));

    if (!message) { return null; }
    const { colors } = playerTheme;
    return (
        <Animated.View pointerEvents="box-none" style={[styles.snackWrap, style]}>
            <GestureDetector gesture={swipeGesture}>
                {/* A tap anywhere but the action dismisses it too. */}
                <Pressable
                    onPress={hide}
                    onLayout={e => { snackWidth.value = Math.max(1, e.nativeEvent.layout.width); }}
                    style={[styles.snack, { backgroundColor: '#2A2A2E' }]}
                    accessibilityLiveRegion="polite"
                    accessibilityHint="Dismisses the message"
                >
                    <Text style={[type.body, styles.snackText, { color: colors.text }]} numberOfLines={2}>{message.text}</Text>
                    {message.action && (
                        <Button
                            variant="ghost"
                            label={message.action}
                            onPlayer
                            onPress={() => {
                                message.onAction?.();
                                hide();
                            }}
                        />
                    )}
                </Pressable>
            </GestureDetector>
        </Animated.View>
    );
}

// ---------------------------------------------------------------------------
// Dialog

interface DialogAction {
    text: string;
    style?: 'default' | 'cancel' | 'destructive';
    onPress?: () => void;
}

interface DialogMessage {
    title: string;
    message?: string;
    actions: DialogAction[];
}

let showDialogListener: ((d: DialogMessage) => void) | undefined;

/** The app's Alert.alert: same arguments, drawn in the app's style by the root's DialogHost. */
export function showDialog(title: string, message?: string, actions: DialogAction[] = [{ text: 'OK' }]) {
    showDialogListener?.({ title, message, actions });
}

/**
 * Mount once, at the app root. Its own Modal window, so it shows above open sheets. Tapping
 * outside or back is the cancel action, or the only action; otherwise it waits for a choice.
 */
export function DialogHost() {
    const { colors } = useUiTheme();
    const [dialog, setDialog] = useState<DialogMessage | null>(null);
    useEffect(() => {
        showDialogListener = setDialog;
        return () => { showDialogListener = undefined; };
    }, []);
    if (!dialog) { return null; }

    const press = (a: DialogAction) => {
        setDialog(null);
        a.onPress?.();
    };
    const dismiss = dialog.actions.find(a => a.style === 'cancel') ?? (dialog.actions.length === 1 ? dialog.actions[0] : undefined);
    const close = () => dismiss && press(dismiss);
    return (
        <Modal transparent visible onRequestClose={close} statusBarTranslucent navigationBarTranslucent animationType="none">
            <View style={[styles.dialogScrim, { backgroundColor: colors.scrim }]}>
                <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
                <Animated.View
                    entering={FadeIn.duration(motion.fadeIn)}
                    accessibilityViewIsModal
                    style={[styles.dialog, { backgroundColor: colors.cardElevated }]}
                >
                    <SheetHeader title={dialog.title} onClose={dismiss && close} />
                    {!!dialog.message && <Text style={[type.body, { color: colors.textSecondary }]}>{dialog.message}</Text>}
                    <View style={styles.dialogActions}>
                        {dialog.actions.map(a => (
                            <Button
                                key={a.text}
                                label={a.text}
                                size="lg"
                                variant={a.style === 'cancel' ? 'secondary' : a.style === 'destructive' ? 'destructive' : 'primary'}
                                onPress={() => press(a)}
                                style={styles.flex}
                            />
                        ))}
                    </View>
                </Animated.View>
            </View>
        </Modal>
    );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
    flex: { flex: 1 },
    dialogScrim: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: metrics.gutter },
    dialog: {
        width: '100%',
        maxWidth: 420,
        borderRadius: metrics.radius.card,
        paddingHorizontal: metrics.space.lg,
        paddingTop: metrics.space.md,
        paddingBottom: metrics.space.lg,
        gap: metrics.space.lg,
    },
    dialogActions: { flexDirection: 'row', gap: metrics.space.sm },
    disabled: { opacity: 0.38 },
    layer: { borderRadius: 4 },
    block: { alignSelf: 'stretch' },

    iconButton: {
        width: 40,
        height: 40,
        borderRadius: metrics.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
    },
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: metrics.space.sm,
        paddingHorizontal: 20,
        overflow: 'hidden',
    },
    buttonWithIcon: { paddingLeft: 16 },
    badge: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
    iconButtonBadge: { top: 7, right: 7 },
    rowIconBadge: { top: -2, right: -3 },
    chip: {
        height: 34,
        paddingHorizontal: 14,
        borderRadius: metrics.radius.pill,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    chipText: { fontVariant: ['tabular-nums'] },
    segmented: { flexDirection: 'row', padding: 3, borderRadius: metrics.radius.pill, gap: 2 },
    segment: {
        flex: 1,
        minHeight: 36,
        paddingHorizontal: metrics.space.sm,
        borderRadius: metrics.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
    },

    switchTrack: { width: SWITCH.w, height: SWITCH.h, borderRadius: SWITCH.h / 2, padding: SWITCH.inset, overflow: 'hidden' },
    switchOn: { borderRadius: SWITCH.h / 2 },
    switchThumb: { width: SWITCH.thumb, height: SWITCH.thumb, borderRadius: SWITCH.thumb / 2 },

    sectionLabel: { paddingHorizontal: metrics.space.lg + metrics.space.md, paddingTop: metrics.space.xl, paddingBottom: metrics.space.sm },
    group: { gap: 2 },
    groupItem: { borderRadius: 4, overflow: 'hidden' },
    groupFirst: { borderTopLeftRadius: metrics.radius.card, borderTopRightRadius: metrics.radius.card },
    groupLast: { borderBottomLeftRadius: metrics.radius.card, borderBottomRightRadius: metrics.radius.card },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 56,
        paddingHorizontal: metrics.space.lg,
        paddingVertical: metrics.space.md,
        gap: metrics.space.lg,
    },
    rowText: { flex: 1, gap: 2 },
    rowTitle: { fontWeight: '400' },
    /** Long values ("English - EAC3 6ch") truncate instead of squeezing the title. */
    rowValue: { maxWidth: '50%', textAlign: 'right' },

    card: { borderRadius: metrics.radius.card },

    header: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: metrics.space.xs },
    headerBack: { marginLeft: -metrics.space.sm },
    headerTitle: { flex: 1 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: metrics.space.xs, marginRight: -metrics.space.sm },

    sheet: {
        position: 'absolute',
        bottom: 0,
        borderTopLeftRadius: metrics.radius.sheet,
        borderTopRightRadius: metrics.radius.sheet,
        paddingHorizontal: metrics.space.lg,
    },
    sheetGrip: { paddingTop: metrics.space.sm, paddingBottom: metrics.space.xs },
    handle: { width: 32, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: metrics.space.sm },
    sheetBody: { marginTop: metrics.space.xs },

    sortButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },

    snackWrap: { position: 'absolute', left: metrics.gutter, right: metrics.gutter, alignItems: 'center', zIndex: 1000 },
    snack: {
        flexDirection: 'row',
        alignItems: 'center',
        maxWidth: 560,
        // Full width up to the cap; the wrapper centres it on wide screens.
        width: '100%',
        minHeight: 48,
        borderRadius: metrics.radius.md,
        paddingLeft: metrics.space.lg,
        paddingRight: metrics.space.xs,
        gap: metrics.space.sm,
    },
    snackText: { flex: 1, paddingVertical: metrics.space.md },
});
