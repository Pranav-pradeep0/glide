import React, { useEffect, useRef, useCallback } from 'react';
import { DefaultTheme, NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useAppStore } from '../store/appStore';
import { useTheme } from '../hooks/useTheme';
import { Feather } from '@react-native-vector-icons/feather';
import { DeepLinkService } from '../services/DeepLinkService';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Touchable, SnackbarHost } from '@/components/ui';
import { metrics, type } from '@/theme/theme';

import OnboardingScreen from '@/screens/OnboardingScreen';
import RecentsScreen from '@/screens/RecentsScreen';
import SettingsScreen from '@/screens/SettingsScreen';
import FoldersScreen from '@/screens/FoldersScreen';
import SearchScreen from '@/screens/SearchScreen';
import PlayerDetailScreen from '@/screens/PlayerDetailScreen';
import VideoPlayerScreen from '@/screens/VideoPlayerScreen';
import AlbumVideosScreen from '@/screens/AlbumVideosScreen';
import MusicScreen from '@/screens/MusicScreen';
import NowPlayingScreen from '@/screens/NowPlayingScreen';
import AlbumDetailScreen from '@/screens/AlbumDetailScreen';
import ArtistDetailScreen from '@/screens/ArtistDetailScreen';
import { MiniPlayer, playerExpansion } from '@/components/MiniPlayer';
import { AudioTrack, MainTabParamList, RootStackParamList } from '@/types';
import { useAudioStore } from '@/store/audioStore';
import { AudioMediaService } from '@/services/AudioMediaService';
import { PermissionService } from '@/services/PermissionService';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_HEIGHT = 64;

// React Navigation calls `tabBar` as a plain function, so TabBar must be rendered as an element to use hooks.
const renderTabBar = (props: BottomTabBarProps) => <TabBar {...props} />;

function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
    const { colors } = useTheme();
    const tabBarHeight = TAB_HEIGHT + insets.bottom;
    // Slides down out of the way as Now Playing opens and back up as it collapses, its top edge
    // tracking the player's bottom edge, so the player never covers the tabs.
    const slideStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: playerExpansion.value * tabBarHeight }],
    }));
    return (
        // The page colour, not the tab bar's: the mini player is a card floating over the page.
        <View style={{ backgroundColor: colors.background }}>
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
    const { colors } = useTheme();
    const updateAvailable = useAppStore((state) => state.updateStatus.available);

    return (
        <Tab.Navigator
            tabBar={renderTabBar}
            screenOptions={{ headerShown: false, lazy: true }}
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
                    tabBarIcon: ({ color }) => (
                        <View>
                            <Feather name="settings" size={22} color={color} />
                            {updateAvailable && <View style={[styles.badge, { backgroundColor: colors.primary }]} />}
                        </View>
                    ),
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
                        component={OnboardingScreen}
                    />
                ) : (
                    <>
                        <Stack.Screen
                            name="MainTabs"
                            component={MainTabs}
                        />
                        <Stack.Screen
                            name="PlayerDetail"
                            component={PlayerDetailScreen}
                            options={{
                                animation: 'slide_from_right',
                            }}
                        />
                        <Stack.Screen
                            name="AlbumVideos"
                            component={AlbumVideosScreen}
                            options={{
                                headerShown: false,
                                animation: 'slide_from_right',
                            }}
                        />
                        <Stack.Screen
                            name="VideoPlayer"
                            component={VideoPlayerScreen}
                            options={{
                                headerShown: false,
                                animation: 'slide_from_right',
                                animationDuration: 200,
                                gestureEnabled: false,
                            }}
                        />
                        <Stack.Screen
                            name="Search"
                            component={SearchScreen}
                            options={{
                                headerShown: false,
                                animation: 'slide_from_right',
                            }}
                        />
                        <Stack.Screen
                            name="NowPlaying"
                            component={NowPlayingScreen}
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
                            component={AlbumDetailScreen}
                            options={{
                                headerShown: false,
                                animation: 'slide_from_right',
                            }}
                        />
                        <Stack.Screen
                            name="ArtistDetail"
                            component={ArtistDetailScreen}
                            options={{
                                headerShown: false,
                                animation: 'slide_from_right',
                            }}
                        />
                    </>
                )}
            </Stack.Navigator>
            <SnackbarHost bottomOffset={TAB_HEIGHT} />
        </NavigationContainer>
    );
}

const styles = StyleSheet.create({
    tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
    tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: metrics.space.xs },
    pill: { width: 56, height: 32, alignItems: 'center', justifyContent: 'center' },
    pillFill: { ...StyleSheet.absoluteFill, borderRadius: 16 },
    label: { fontWeight: '500' },
    badge: { position: 'absolute', top: -2, right: -4, width: 8, height: 8, borderRadius: 4 },
});
