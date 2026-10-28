import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, DeviceEventEmitter } from 'react-native';
import { BaseNavigationContainer, DarkTheme, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ErrorBoundary } from '../ErrorBoundary';
import VideoPlayerScreen from '@/screens/VideoPlayerScreen';
import PlayerDetailScreen from '@/screens/PlayerDetailScreen';
import { useTheme } from '@/hooks/useTheme';
import { DeepLinkService } from '@/services/DeepLinkService';
import { ContentDetector } from '@/services/ContentDetector';
import { NavigationService } from '@/services/NavigationService';
import { SystemBars } from 'react-native-edge-to-edge';
import { finishCurrentActivity } from '@/native/PipModule';
import { useActivityBackButton } from '@/navigation/useActivityBackButton';
import { ExternalPlayerContext } from '@/navigation/ExternalPlayerContext';
import type { LaunchExtras } from '@/services/DeepLinkService';

const Stack = createNativeStackNavigator();

type OpenRequest = { routeName: string; params: any };

/**
 * Which screen an opened video lands on. A film or an episode gets its detail screen
 * first; anything else, and every stream, goes straight to the player.
 */
async function resolveRoute(extras: LaunchExtras & { videoUri: string }): Promise<OpenRequest> {
    const uri = extras.videoUri;
    const startPositionMs = extras.startPositionMs ?? 0;
    const external = DeepLinkService.externalOpenFrom(extras);
    let resolvedPath = uri;
    try {
        resolvedPath = await DeepLinkService.resolveToFilePath(uri);
    } catch (error) {
        // The player can still try the URI as given, and shows its own error if it can't.
        console.error('[VideoPlayerRoot] Could not resolve', uri, error);
    }
    // Name it from the resolved path: a MediaStore URI (.../video/media/1234) only names "External Video".
    // The sender's title beats both, and secure_uri forbids reading one off the link.
    const videoName = extras.title
        || (external.secureUri ? 'Video' : DeepLinkService.getVideoNameFromUri(resolvedPath));

    let routeName = 'VideoPlayer';
    if (!NavigationService.isNetworkStream(resolvedPath)) {
        const classification = ContentDetector.classifySync(resolvedPath);
        if (classification.contentType === 'movie' || classification.contentType === 'series') {
            routeName = 'PlayerDetail';
        }
    }

    return {
        routeName,
        params: {
            videoPath: resolvedPath,
            videoName,
            isExternalOpen: true,
            startPosition: startPositionMs > 0 ? startPositionMs / 1000 : undefined,
            external,
        },
    };
}

export default function VideoPlayerRoot(extras: LaunchExtras) {
    const { videoUri } = extras;
    const theme = useTheme();
    const navigationRef = useRef<NavigationContainerRef<any>>(null);
    useActivityBackButton(navigationRef, 'VideoPlayerActivity');
    const openedUriRef = useRef<string | undefined>(videoUri);

    const [ready, setReady] = useState(false);
    const [initialState, setInitialState] = useState<OpenRequest | null>(null);

    useEffect(() => {
        const prepare = async () => {
            if (!videoUri) {
                // Nothing to play: leave instead of spinning forever.
                finishCurrentActivity();
                return;
            }
            openedUriRef.current = videoUri;
            setInitialState(await resolveRoute({ ...extras, videoUri }));
            setReady(true);
        };
        prepare();
        // Launch options are fixed for the Activity's life; a new intent arrives as an event.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoUri]);

    // A second "Open with" while this Activity is alive, relayed from its onNewIntent.
    useEffect(() => {
        const sub = DeviceEventEmitter.addListener('onNewVideoUri', async (next: LaunchExtras) => {
            const newUri = next?.videoUri;
            // Re-opening what is already playing would restart it from the top.
            if (!newUri || newUri === openedUriRef.current) { return; }
            openedUriRef.current = newUri;

            const request = await resolveRoute({ ...next, videoUri: newUri });
            if (navigationRef.current?.isReady()) {
                navigationRef.current.reset({
                    index: 0,
                    routes: [{ name: request.routeName, params: request.params }],
                });
            } else {
                setInitialState(request);
            }
        });
        return () => sub.remove();
    }, []);

    // Set dark mode for system bars since player is usually dark
    useEffect(() => {
        SystemBars.setStyle('light');
        SystemBars.setHidden(false);
        return () => {
            SystemBars.setStyle('auto');
        };
    }, []);

    if (!ready || !initialState) {
        return (
            <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
        );
    }

    return (
        <SafeAreaProvider style={{ flex: 1, backgroundColor: '#000' }}>
            <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
                <ErrorBoundary onError={console.error}>
                    <ExternalPlayerContext.Provider value={true}>
                    <BaseNavigationContainer ref={navigationRef} theme={DarkTheme}>
                        <Stack.Navigator
                            initialRouteName={initialState.routeName}
                            screenOptions={{ headerShown: false }}
                        >
                            <Stack.Screen
                                name="PlayerDetail"
                                component={PlayerDetailScreen}
                                initialParams={initialState.routeName === 'PlayerDetail' ? initialState.params : undefined}
                            />
                            <Stack.Screen
                                name="VideoPlayer"
                                // @ts-ignore
                                component={VideoPlayerScreen}
                                initialParams={initialState.routeName === 'VideoPlayer' ? initialState.params : undefined}
                            />
                        </Stack.Navigator>
                    </BaseNavigationContainer>
                    </ExternalPlayerContext.Provider>
                </ErrorBoundary>
            </GestureHandlerRootView>
        </SafeAreaProvider>
    );
}
