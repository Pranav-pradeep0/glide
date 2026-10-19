import React, { useEffect, useRef, useCallback } from 'react';
import { DefaultTheme, NavigationContainer, NavigationContainerRef, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useAppStore } from '../store/appStore';
import { useTheme } from '../hooks/useTheme';
import { Feather } from '@react-native-vector-icons/feather';
import { DeepLinkService } from '../services/DeepLinkService';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Button, DialogHost, Touchable, SnackbarHost, useSnackbarClearance } from '@/components/ui';
import { ErrorBoundary } from '../../ErrorBoundary';
import { SystemBars } from 'react-native-edge-to-edge';
import { metrics, type } from '@/theme/theme';

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
const renderTabBar = (props: BottomTabBarProps) => <TabBar {...props} />;

function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
    const { colors } = useTheme();
    const tabBarHeight = TAB_HEIGHT + insets.bottom;
    const onBarLayout = useSnackbarClearance();
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
                    const label = options.title ?? route.name;
                    const onPress = () => {
                        const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                        if (!focused && !event.defaultPrevented) {
                            navigation.navigate(route.name, route.params);
                        }
                    };
                    return (
                        <Touchable
                            key={route.key}
                            onPress={onPress}
                            scaleTo={1}
                            accessibilityRole="tab"
                            accessibilityLabel={label}
                            accessibilityState={{ selected: focused }}
                            style={styles.tab}
                        >
                            <View style={styles.pill}>
                                {/* Mounted fresh with its colour: Fabric drops borderRadius when a background is added to an existing view. */}
                                {focused && <View style={[styles.pillFill, { backgroundColor: colors.primaryContainer }]} />}
                                {options.tabBarIcon?.({ focused, color: focused ? colors.primary : colors.textSecondary, size: 24 })}
                            </View>
                            <Text style={[type.caption, styles.label, { color: focused ? colors.text : colors.textSecondary }]}>
                                {label}
                            </Text>
                        </Touchable>
                    );
                })}
            </Animated.View>
        </View>
    );
}

function MainTabs() {
    return (
        <Tab.Navigator
            tabBar={renderTabBar}
            screenOptions={{ headerShown: false, lazy: true, freezeOnBlur: true }}
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
            <Tab.Screen
                name="Music"
                component={MusicScreen}
                options={{
                    title: 'Music',
                    tabBarIcon: ({ color }) => <Feather name="music" size={22} color={color} />,
                }}
            />
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
        <NavigationContainer
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
                            options={{
                                headerShown: false,
                                animation: 'slide_from_right',
                                animationDuration: 200,
                                gestureEnabled: false,
                            }}
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
                        <Stack.Screen
                            name="HapticsLab"
                            getComponent={() => require('@/screens/HapticsLabScreen').default}
                        />
                    </>
                )}
            </Stack.Navigator>
            <SnackbarHost aboveBottomBar />
            <DialogHost />
        </NavigationContainer>
    );
}

const styles = StyleSheet.create({
    tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
    tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: metrics.space.xs },
    pill: { width: 56, height: 32, alignItems: 'center', justifyContent: 'center' },
    pillFill: { ...StyleSheet.absoluteFill, borderRadius: 16 },
    label: { fontWeight: '500' },
    playerCrash: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: metrics.space.xl, gap: metrics.space.md },
    playerCrashDetail: { textAlign: 'center' },
});
