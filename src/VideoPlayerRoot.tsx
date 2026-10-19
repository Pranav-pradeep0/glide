import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, DeviceEventEmitter } from 'react-native';
import { NavigationContainer, DarkTheme, NavigationContainerRef } from '@react-navigation/native';
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

const Stack = createNativeStackNavigator();

type Props = {
    videoUri?: string;
};

type OpenRequest = { routeName: string; params: any };

/**
 * Which screen an opened video lands on. A film or an episode gets its detail screen
 * first; anything else, and every stream, goes straight to the player.
 */
async function resolveRoute(uri: string): Promise<OpenRequest> {
    // Resolve content URI to file path
    const resolvedPath = await DeepLinkService.resolveToFilePath(uri);
    // Name it from the resolved path: a MediaStore URI (.../video/media/1234) only names "External Video".
    const videoName = DeepLinkService.getVideoNameFromUri(resolvedPath);

    let routeName = 'VideoPlayer';
    if (!NavigationService.isNetworkStream(resolvedPath)) {
        const classification = ContentDetector.classifySync(resolvedPath);
        if (classification.contentType === 'movie' || classification.contentType === 'series') {
            routeName = 'PlayerDetail';
        }
    }

    return {
        routeName,
        params: { videoPath: resolvedPath, videoName, isExternalOpen: true },
    };
}

export default function VideoPlayerRoot({ videoUri }: Props) {
    const theme = useTheme();
    const navigationRef = useRef<NavigationContainerRef<any>>(null);
    const openedUriRef = useRef<string | undefined>(videoUri);

    const [ready, setReady] = useState(false);
    const [initialState, setInitialState] = useState<OpenRequest | null>(null);

    useEffect(() => {
        const prepare = async () => {
            if (videoUri) {
                openedUriRef.current = videoUri;
                setInitialState(await resolveRoute(videoUri));
            }
            setReady(true);
        };
        prepare();
    }, [videoUri]);

    // A second "Open with" while this Activity is alive, relayed from its onNewIntent.
    useEffect(() => {
        const sub = DeviceEventEmitter.addListener('onNewVideoUri', async (newUri: string) => {
            // Re-opening what is already playing would restart it from the top.
            if (!newUri || newUri === openedUriRef.current) { return; }
            openedUriRef.current = newUri;

            const next = await resolveRoute(newUri);
            if (navigationRef.current?.isReady()) {
                navigationRef.current.reset({
                    index: 0,
                    routes: [{ name: next.routeName, params: next.params }],
                });
            } else {
                setInitialState(next);
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
                    <NavigationContainer ref={navigationRef} theme={DarkTheme}>
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
                    </NavigationContainer>
                </ErrorBoundary>
            </GestureHandlerRootView>
        </SafeAreaProvider>
    );
}
