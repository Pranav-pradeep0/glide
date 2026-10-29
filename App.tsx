import RootNavigator from '@/navigation/RootNavigator';
import { FileService } from '@/services/FileService';
import { SMB_AVAILABLE, SmbService } from '@/services/SmbService';
import { useAppStore } from '@/store/appStore';
import { useTheme } from '@/hooks/useTheme';
import { useVideoIndexStore } from '@/store/videoIndexStore';
import { ErrorBoundary } from './ErrorBoundary';
import React, { useEffect, useState, useRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { withStallion } from 'react-native-stallion';
import { NativeModules } from 'react-native';

function App() {
  const [appReady, setAppReady] = useState(false);
  const [navReady, setNavReady] = useState(false);
  const theme = useTheme();
  const hasCompletedOnboarding = useAppStore((state) => state.settings.hasCompletedOnboarding);

  const initialize = useVideoIndexStore((state) => state.initialize);
  const hasStartedMediaInitRef = useRef(false);

  useEffect(() => {
    initializeApp();
  }, []);

  useEffect(() => {
    if (!appReady || !navReady || !hasCompletedOnboarding) {
      return;
    }

    if (hasStartedMediaInitRef.current) {
      return;
    }
    hasStartedMediaInitRef.current = true;

    initialize().catch((error) => {
      console.error('Media index initialization error:', error);
    });
  }, [appReady, navReady, hasCompletedOnboarding, initialize]);

  useEffect(() => {
    if (appReady && navReady) {
      NativeModules.SplashModule?.hide();
    }
  }, [appReady, navReady]);

  async function initializeApp() {
    try {
      const subtitleCacheDir = FileService.getSubtitleCacheDir();
      await FileService.ensureDir(subtitleCacheDir);
      // Recents can open a share's video before anything else touches the network.
      if (SMB_AVAILABLE && SmbService.servers().length > 0) {
        SmbService.ready().catch(error => console.error('SMB logins:', error));
      }

      setAppReady(true);
      console.log('App initialized successfully');
    } catch (error) {
      console.error('Initialization error:', error);
      setAppReady(true);
    }
  }

  return (
    <SafeAreaProvider
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorBoundary
          onError={(error, errorInfo) => console.log('App Error:', error, errorInfo)}
          onReset={() => console.log('App Reset')}
        >
          <RootNavigator onReady={() => setNavReady(true)} />
        </ErrorBoundary>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

export default withStallion(App);
