import React, { useEffect, useRef, useCallback, useState } from 'react';
import { BaseNavigationContainer, DefaultTheme, NavigationContainerRef, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useAppStore } from '../store/appStore';
import { useTheme } from '../hooks/useTheme';
import { Feather } from '@react-native-vector-icons/feather';
import { DeepLinkService } from '../services/DeepLinkService';
import { StyleSheet, Text, View, type HostInstance } from 'react-native';
import Animated, { Easing, interpolateColor, SharedValue, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Button, DialogHost, Touchable, SnackbarHost, useSnackbarClearance } from '@/components/ui';
import { ErrorBoundary } from '../../ErrorBoundary';
import { SystemBars } from 'react-native-edge-to-edge';
import { metrics, motion, type } from '@/theme/theme';
import { IS_TV } from '@/utils/tv';
import { tvFocus } from '@/hooks/video-player/useTvRemote';
import { useActivityBackButton } from './useActivityBackButton';

// The four tabs are what the first frame needs, so they are imported.
//
// Everything else is reached by a navigation, and `getComponent` is how a native-stack
// screen stays unevaluated until then. Imported, the player, Now Playing and their whole
// dependency trees -- the player hooks, the subtitle parser, the haptic engine -- are all
// parsed and run before the library list can paint.
import RecentsScreen from '@/screens/RecentsScreen';
import SettingsScreen from '@/screens/SettingsScreen';
import FoldersScreen from '@/screens/FoldersScreen';
import MusicScreen from '@/screens/MusicScreen';
import AlbumVideosScreen from '@/screens/AlbumVideosScreen';
import { MiniPlayer, playerExpansion } from '@/components/MiniPlayer';
import { AudioTrack, MainTabParamList, RootStackParamList } from '@/types';
import { useAudioStore } from '@/store/audioStore';
import { AudioMediaService } from '@/services/AudioMediaService';
import { PermissionService } from '@/services/PermissionService';

/**
 * The player gets its own error boundary.
 *
 * There is one boundary at the root of the app, and a render crash inside the player used
 * to hit that one: the fallback replaced the whole navigator, and its Try Again remounted
 * straight back into the same crash. Here the navigator survives, and the way out is back
 * to the library.
 */
function PlayerCrashFallback({ error }: { error: Error }) {
    const { colors } = useTheme();
    const navigation = useNavigation();
    return (
        <View style={[styles.playerCrash, { backgroundColor: colors.background }]}>
            <Text style={[type.heading, { color: colors.text }]}>This video could not be played</Text>
            <Text style={[type.caption, styles.playerCrashDetail, { color: colors.textSecondary }]}>
                {error.message}
            </Text>
            <Button label="Back to library" variant="primary" onPress={() => navigation.goBack()} />
        </View>
    );
}

const playerLayout = ({ children }: { children: React.ReactNode }) => (
    <ErrorBoundary fallback={PlayerCrashFallback}>{children}</ErrorBoundary>
);

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_HEIGHT = 64;

// React Navigation calls `tabBar` as a plain function, so TabBar must be rendered as an element to use hooks.
const renderTabBar = (props: BottomTabBarProps) => (IS_TV ? <SideRail {...props} /> : <TabBar {...props} />);

const RAIL = { collapsed: 80, expanded: 240 };

/**
 * TV: the Android TV navigation drawer. Icons only until D-pad focus enters it, then it widens
 * over the page to show the labels, so the page never reflows. Selecting an item opens the tab;
 * focus stays on the rail and Right goes back to the page. No mini player: TV is videos only.
 */
function SideRail({ state, descriptors, navigation }: BottomTabBarProps) {
    const { colors } = useTheme();
    const selected = useSharedValue(state.index);
    useEffect(() => { selected.value = state.index; }, [state.index, selected]);
    // Moving between items blurs one before focusing the next; counting keeps the drawer open across it.
    const focusCount = useRef(0);
    const expanded = useSharedValue(0);
    // Left from the page lands on whichever item is level with the focused card; entering, focus
    // goes on to the current tab's item. A blur and the next item's focus arrive together, so
    // "inside" is only cleared a frame after a blur that no rail focus followed.
    // ponytail: frame timing; if an entry is ever missed, Android's guess stands (still usable).
    const activeRef = useRef<HostInstance>(null);
    const inside = useRef(false);
    const leaving = useRef(0);
    // Back (or a page's own link) changed the tab: the focused view went with the old page and
    // Android picks the new page's first view (Videos' grid toggle). Land on the rail instead.
    const shownIndex = useRef(state.index);
    useEffect(() => {
        if (shownIndex.current === state.index) { return; }
        shownIndex.current = state.index;
        if (!inside.current) { tvFocus(activeRef); }
    }, [state.index]);
    const onFocusChange = useCallback((delta: 1 | -1, isActive: boolean) => {
        if (delta === 1) {
            cancelAnimationFrame(leaving.current);
            if (!inside.current && !isActive) { tvFocus(activeRef); }
            inside.current = true;
        } else {
            leaving.current = requestAnimationFrame(() => { inside.current = false; });
        }
        focusCount.current = Math.max(0, focusCount.current + delta);
        expanded.value = withSpring(focusCount.current > 0 ? 1 : 0, motion.spatial);
    }, [expanded]);
    const panelStyle = useAnimatedStyle(() => ({
        width: RAIL.collapsed + (RAIL.expanded - RAIL.collapsed) * expanded.value,
    }));
    return (
        <View style={styles.rail}>
            <Animated.View style={[styles.railPanel, { backgroundColor: colors.surface, borderRightColor: colors.border }, panelStyle]}>
                {state.routes.map((route, index) => {
                    const { options } = descriptors[route.key];
                    const focused = state.index === index;
                    const onPress = () => {
                        const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                        if (!focused && !event.defaultPrevented) {
                            selected.value = index;
                            navigation.navigate(route.name, route.params);
                        }
                    };
                    return (
                        <View key={route.key} ref={focused ? activeRef : undefined} collapsable={false}>
                        <RailItem
                            label={options.title ?? route.name}
                            icon={options.tabBarIcon}
                            focused={focused}
                            index={index}
                            selected={selected}
                            expanded={expanded}
                            onPress={onPress}
                            onFocusChange={onFocusChange}
                        />
                        </View>
                    );
                })}
            </Animated.View>
        </View>
    );
}

function RailItem({ label, icon, focused, index, selected, expanded, onPress, onFocusChange }: TabItemProps & {
    expanded: SharedValue<number>; onFocusChange: (delta: 1 | -1, isActive: boolean) => void;
}) {
    const { colors } = useTheme();
    const active = useIndicator(selected, index, focused);
    const [hasFocus, setHasFocus] = useState(false);
    const labelStyle = useAnimatedStyle(() => ({
        color: interpolateColor(active.value, [0, 1], [colors.textSecondary, colors.text]),
        opacity: expanded.value,
    }));
    return (
        <Touchable
            onPress={onPress}
            onFocus={() => { setHasFocus(true); onFocusChange(1, focused); }}
            onBlur={() => { setHasFocus(false); onFocusChange(-1, focused); }}
            scaleTo={1}
            // The rail draws its own focus fill; no ring or focus tint stacked on it.
            focusRing={false}
            stateLayer={false}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: focused }}
            style={[styles.railItem, hasFocus && { backgroundColor: colors.fillStrong }]}
        >
            <NavPill icon={icon} index={index} selected={selected} active={active} />
            <Animated.Text numberOfLines={1} style={[type.label, styles.railLabel, labelStyle]}>{label}</Animated.Text>
        </Touchable>
    );
}

function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
    const { colors } = useTheme();
    const tabBarHeight = TAB_HEIGHT + insets.bottom;
    const onBarLayout = useSnackbarClearance();
    // Set on the tap itself, so the indicator moves on the UI thread while JS is still busy
    // rendering the tab it opens; navigation then confirms it.
    const selected = useSharedValue(state.index);
    useEffect(() => { selected.value = state.index; }, [state.index, selected]);
    // Slides down out of the way as Now Playing opens and back up as it collapses, its top edge
    // tracking the player's bottom edge, so the player never covers the tabs.
    const slideStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: playerExpansion.value * tabBarHeight }],
    }));
    return (
        // The page colour, not the tab bar's: the mini player is a card floating over the page.
        <View style={{ backgroundColor: colors.background }} onLayout={onBarLayout}>
            <MiniPlayer />
            <Animated.View
                style={[
                    styles.tabBar,
                    {
                        backgroundColor: colors.surface,
                        borderTopColor: colors.border,
                        paddingBottom: insets.bottom,
                        height: tabBarHeight,
                    },
                    slideStyle,
                ]}
            >
                {state.routes.map((route, index) => {
                    const { options } = descriptors[route.key];
                    const focused = state.index === index;
                    const onPress = () => {
                        const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                        if (!focused && !event.defaultPrevented) {
                            selected.value = index;
                            navigation.navigate(route.name, route.params);
                        }
                    };
                    return (
                        <TabItem
                            key={route.key}
                            label={options.title ?? route.name}
                            icon={options.tabBarIcon}
                            focused={focused}
                            index={index}
                            selected={selected}
                            onPress={onPress}
                        />
                    );
                })}
            </Animated.View>
        </View>
    );
}

const PILL = { width: 56, height: 32 };

interface TabItemProps {
    label: string;
    icon: BottomTabBarProps['descriptors'][string]['options']['tabBarIcon'];
    focused: boolean;
    index: number;
    selected: SharedValue<number>;
    onPress: () => void;
}

// M3: the indicator grows with emphasized-decelerate easing; the old one just fades.
const GROW = { duration: 200, easing: Easing.bezier(0.05, 0.7, 0.1, 1) };
const SHRINK = { duration: 100 };

/**
 * M3 navigation bar item: the active indicator grows out from the icon's centre and the
 * label colour follows it; the icon swaps to its selected colouring at once.
 */
function TabItem({ label, icon, focused, index, selected, onPress }: TabItemProps) {
    const { colors } = useTheme();
    const active = useIndicator(selected, index, focused);
    const labelStyle = useAnimatedStyle(() => ({
        color: interpolateColor(active.value, [0, 1], [colors.textSecondary, colors.text]),
    }));

    return (
        <Touchable
            onPress={onPress}
            scaleTo={1}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: focused }}
            style={styles.tab}
        >
            <NavPill icon={icon} index={index} selected={selected} active={active} />
            <Animated.Text style={[type.caption, styles.label, labelStyle]}>{label}</Animated.Text>
        </Touchable>
    );
}

/** 0..1, how far this item's active indicator has grown. */
function useIndicator(selected: SharedValue<number>, index: number, focused: boolean) {
    const active = useSharedValue(focused ? 1 : 0);
    useAnimatedReaction(
        () => selected.value === index,
        (on, was) => {
            if (on !== was) { active.value = withTiming(on ? 1 : 0, on ? GROW : SHRINK); }
        },
    );
    return active;
}

function NavPill({ icon, index, selected, active }: Pick<TabItemProps, 'icon' | 'index' | 'selected'> & { active: SharedValue<number> }) {
    const { colors } = useTheme();
    // Width, not scaleX, so the ends stay round as it grows.
    const pillStyle = useAnimatedStyle(() => {
        const width = PILL.width * active.value;
        return { width, left: (PILL.width - width) / 2, opacity: Math.min(1, active.value * 3) };
    });
    return (
        <View style={styles.pill}>
            {/* Always mounted with its colour: Fabric drops borderRadius when a background is added to an existing view. */}
            <Animated.View style={[styles.pillFill, { backgroundColor: colors.primaryContainer }, pillStyle]} />
            {/* The glyph takes a plain colour, so both colourings are mounted and one shows. */}
            <TabIcon selected={selected} index={index} showWhenSelected={false}>
                {icon?.({ focused: false, color: colors.textSecondary, size: 24 })}
            </TabIcon>
            <TabIcon selected={selected} index={index} showWhenSelected>
                {icon?.({ focused: true, color: colors.primary, size: 24 })}
            </TabIcon>
        </View>
    );
}

function TabIcon({ selected, index, showWhenSelected, children }: {
    selected: SharedValue<number>; index: number; showWhenSelected: boolean; children: React.ReactNode;
}) {
    const style = useAnimatedStyle(() => ({ opacity: (selected.value === index) === showWhenSelected ? 1 : 0 }));
    return <Animated.View style={[styles.tabIcon, style]}>{children}</Animated.View>;
}

function MainTabs() {
    return (
        <Tab.Navigator
            tabBar={renderTabBar}
            // Fade, M3's fade-through for top-level destinations; the bar and mini player sit outside the scenes.
            // TV: the rail sits left of the page; Back from another tab returns to Videos (the
            // default 'firstRoute'), and from Videos leaves the app.
            screenOptions={{ headerShown: false, lazy: true, freezeOnBlur: true, animation: 'fade', tabBarPosition: IS_TV ? 'left' : 'bottom' }}
        >
            <Tab.Screen
                name="Folders"
                component={FoldersScreen}
                options={{
                    // The route stays "Folders"; only what the user sees changed when music arrived.
                    title: 'Videos',
                    tabBarIcon: ({ color }) => <Feather name="film" size={22} color={color} />,
                }}
            />
            <Tab.Screen
                name="Recents"
                component={RecentsScreen}
                options={{
                    title: 'Recents',
                    tabBarIcon: ({ color }) => <Feather name="clock" size={22} color={color} />,
                }}
            />
            {/* TV is videos only for now. */}
            {!IS_TV && (
                <Tab.Screen
                    name="Music"
                    component={MusicScreen}
                    options={{
                        title: 'Music',
                        tabBarIcon: ({ color }) => <Feather name="music" size={22} color={color} />,
                    }}
                />
            )}
            <Tab.Screen
                name="Settings"
                component={SettingsScreen}
                options={{
                    title: 'Settings',
                    tabBarIcon: ({ color }) => <Feather name="settings" size={22} color={color} />,
                }}
            />
        </Tab.Navigator>
    );
}

interface RootNavigatorProps {
    onReady?: () => void;
}

export default function RootNavigator({ onReady }: RootNavigatorProps) {
    const hasCompletedOnboarding = useAppStore((state) => state.settings.hasCompletedOnboarding);
    const theme = useTheme();
    const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
    useActivityBackButton(navigationRef, 'MainActivity');

    // Set when an opened file arrives before navigation is ready (a cold start); the player
    // opens as soon as it is.
    const pendingNowPlaying = useRef(false);

    const openNowPlaying = useCallback(() => {
        const nav = navigationRef.current;
        if (!nav?.isReady()) {
            pendingNowPlaying.current = true;
            return;
        }
        pendingNowPlaying.current = false;
        // Absent while onboarding is showing; the song still plays.
        if (nav.getRootState()?.routeNames.includes('NowPlaying')) {
            nav.navigate('NowPlaying');
        }
    }, []);

    // Only audio reaches MainActivity: its sole VIEW filter is audio/*. Video goes to
    // VideoPlayerActivity instead.
    useEffect(() => {
        // TV has no music UI, so an opened song would play with no way to see or stop it.
        if (IS_TV) { return; }
        const playOpenedFile = async (url: string | null) => {
            if (!url || !DeepLinkService.isOpenableAudioUri(url)) { return; }
            // The url event is process-wide, so a video opened into VideoPlayerActivity is
            // announced here too. Only what the system calls audio gets played as audio.
            if (!(await DeepLinkService.isAudioContent(url))) { return; }
            // Files by Google and others hand over the MediaStore URI, which is exactly how the
            // library stores each song, so a library song keeps its title, artist and cover.
            const inLibrary = (await PermissionService.checkAudioPermission())
                ? (await AudioMediaService.getSongs()).find((s) => s.uri === url)
                : undefined;
            const fileName = DeepLinkService.getVideoNameFromUri(url);
            // ponytail: outside the library the title is the file name and the artist unknown;
            // reading the file's tags (MediaMetadataRetriever) is the upgrade if that matters.
            const track: AudioTrack = inLibrary ?? {
                id: url,
                title: fileName === 'External Video' ? 'Audio file' : fileName.replace(/\.[^.]+$/, ''),
                artist: 'Unknown Artist',
                album: '',
                albumId: '',
                duration: 0,
                path: '',
                uri: url,
                size: 0,
                trackNumber: 0,
            };
            useAudioStore.getState().playTrack(track, [track], 'Files');
            openNowPlaying();
        };
        DeepLinkService.getInitialUrl().then(playOpenedFile);
        return DeepLinkService.addUrlListener(playOpenedFile);
    }, [openNowPlaying]);

    const onNavigationReady = useCallback(() => {
        if (__DEV__) { console.log('[RootNavigator] Navigation ready'); }
        if (pendingNowPlaying.current) { openNowPlaying(); }
        // Wait for one frame to ensure paint has started
        requestAnimationFrame(() => {
            onReady?.();
        });
    }, [onReady, openNowPlaying]);

    return (
        <BaseNavigationContainer
            ref={navigationRef}
            onReady={onNavigationReady}
            theme={{
                ...DefaultTheme,
                dark: theme.dark,
                colors: {
                    primary: theme.colors.primary,
                    background: theme.colors.background,
                    card: theme.colors.surface,
                    text: theme.colors.text,
                    border: theme.colors.border,
                    notification: theme.colors.primary,
                },
            }}
        >
            {/* The base of the bars stack: the player pushes its own entry and this returns when it leaves. */}
            <SystemBars style={theme.dark ? 'light' : 'dark'} hidden={false} />
            <Stack.Navigator
                screenOptions={{
                    headerShown: false,
                    animation: 'slide_from_right',
                    animationDuration: 220,
                    animationMatchesGesture: true,
                    gestureEnabled: true,
                    contentStyle: { backgroundColor: theme.colors.background },
                }}
            >
                {!hasCompletedOnboarding ? (
                    <Stack.Screen
                        name="Onboarding"
                        getComponent={() => require('@/screens/OnboardingScreen').default}
                    />
                ) : (
                    <>
                        {/* Deliberately not frozen on blur: Now Playing is a transparent
                            modal and the mini player keeps animating underneath it. */}
                        <Stack.Screen
                            name="MainTabs"
                            component={MainTabs}
                        />
                        <Stack.Screen
                            name="PlayerDetail"
                            getComponent={() => require('@/screens/PlayerDetailScreen').default}
                            options={{
                                animation: 'slide_from_right',
                                freezeOnBlur: true,
                            }}
                        />
                        <Stack.Screen
                            name="AlbumVideos"
                            component={AlbumVideosScreen}
                            options={{
                                headerShown: false,
                                animation: 'slide_from_right',
                                // The screen the player is usually opened from. It
                                // subscribes to the history store, which the player writes
                                // to as it plays, so unfrozen it re-renders all the way
                                // through the film.
                                freezeOnBlur: true,
                            }}
                        />
                        <Stack.Screen
                            name="VideoPlayer"
                            layout={playerLayout}
                            getComponent={() => require('@/screens/VideoPlayerScreen').default}
                            options={({ route }) => ({
                                headerShown: false,
                                animation: 'slide_from_right',
                                // Previous replaces the screen too; 'pop' plays the slide backwards.
                                animationTypeForReplace: route.params?.previous ? 'pop' : 'push',
                                animationDuration: 200,
                                gestureEnabled: false,
                            })}
                        />
                        <Stack.Screen
                            name="Search"
                            getComponent={() => require('@/screens/SearchScreen').default}
                            options={{
                                headerShown: false,
                                animation: 'slide_from_right',
                                freezeOnBlur: true,
                            }}
                        />
                        {/* Music-only; TV is videos only for now. */}
                        {!IS_TV && (
                            <>
                                <Stack.Screen
                                    name="NowPlaying"
                                    getComponent={() => require('@/screens/NowPlayingScreen').default}
                                    options={{
                                        headerShown: false,
                                        // Transparent and unanimated: the screen animates itself out of
                                        // the mini player, which stays visible underneath.
                                        animation: 'none',
                                        presentation: 'transparentModal',
                                        contentStyle: { backgroundColor: 'transparent' },
                                    }}
                                />
                                <Stack.Screen
                                    name="AlbumDetail"
                                    getComponent={() => require('@/screens/AlbumDetailScreen').default}
                                    options={{
                                        headerShown: false,
                                        animation: 'slide_from_right',
                                        freezeOnBlur: true,
                                    }}
                                />
                                <Stack.Screen
                                    name="ArtistDetail"
                                    getComponent={() => require('@/screens/ArtistDetailScreen').default}
                                    options={{
                                        headerShown: false,
                                        animation: 'slide_from_right',
                                        freezeOnBlur: true,
                                    }}
                                />
                            </>
                        )}
                        {/* Dev screen; release builds have no HapticsLab native module. */}
                        {__DEV__ && (
                            <Stack.Screen
                                name="HapticsLab"
                                getComponent={() => require('@/screens/HapticsLabScreen').default}
                            />
                        )}
                    </>
                )}
            </Stack.Navigator>
            <SnackbarHost aboveBottomBar />
            <DialogHost />
        </BaseNavigationContainer>
    );
}

const styles = StyleSheet.create({
    tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
    // Drawn over the page (zIndex) so the panel can widen past its slot.
    rail: { width: RAIL.collapsed, zIndex: 1 },
    railPanel: {
        position: 'absolute', top: 0, bottom: 0, left: 0, overflow: 'hidden',
        paddingVertical: metrics.space.xxl, paddingHorizontal: metrics.space.md, gap: metrics.space.sm,
        borderRightWidth: StyleSheet.hairlineWidth,
    },
    railItem: {
        flexDirection: 'row', alignItems: 'center', gap: metrics.space.lg,
        height: metrics.touch, borderRadius: metrics.radius.pill,
    },
    railLabel: { flexShrink: 0 },
    tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: metrics.space.xs },
    pill: { ...PILL, alignItems: 'center', justifyContent: 'center' },
    pillFill: { position: 'absolute', top: 0, bottom: 0, borderRadius: PILL.height / 2 },
    tabIcon: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    label: { fontWeight: '500' },
    playerCrash: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: metrics.space.xl, gap: metrics.space.md },
    playerCrashDetail: { textAlign: 'center' },
});
