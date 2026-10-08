import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
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

export default function VideoPlayerRoot({ videoUri }: Props) {
    const theme = useTheme();

    const [ready, setReady] = useState(false);
    const [initialState, setInitialState] = useState<{
        routeName: string;
        params: any;
    } | null>(null);

    useEffect(() => {
        const prepare = async () => {
            if (videoUri) {
                const videoName = DeepLinkService.getVideoNameFromUri(videoUri);
                // Resolve content URI to file path
                const resolvedPath = await DeepLinkService.resolveToFilePath(videoUri);

                const isStream = NavigationService.isNetworkStream(resolvedPath);

                let targetRoute = 'VideoPlayer';

                if (!isStream) {
                    // Check if content is movie/series
                    const classification = ContentDetector.classifySync(resolvedPath);
                    if (classification.contentType === 'movie' || classification.contentType === 'series') {
                        targetRoute = 'PlayerDetail';
                    }
                }

                setInitialState({
                    routeName: targetRoute,
                    params: {
                        videoPath: resolvedPath,
                        videoName: videoName,
                        isExternalOpen: true,
                    },
                });
            }
            setReady(true);
        };
        prepare();
    }, [videoUri]);

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
                    <NavigationContainer theme={DarkTheme}>
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
