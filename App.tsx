import RootNavigator from '@/navigation/RootNavigator';
import { FileService } from '@/services/FileService';
import { useAppStore } from '@/store/appStore';
import { useTheme } from '@/hooks/useTheme';
import { useVideoIndexStore } from '@/store/videoIndexStore';
import { ErrorBoundary } from './ErrorBoundary';
import React, { useEffect, useState, useRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SystemBars } from 'react-native-edge-to-edge';
import { withStallion } from 'react-native-stallion';
import { NativeModules } from 'react-native';
import UpdateModal from '@/components/UpdateModal';
import { refreshUpdateStatus } from '@/services/refreshUpdateStatus';

function App() {
  const [appReady, setAppReady] = useState(false);
  const [navReady, setNavReady] = useState(false);
  const theme = useTheme();
  const hasCompletedOnboarding = useAppStore((state) => state.settings.hasCompletedOnboarding);
  const updateStatus = useAppStore((state) => state.updateStatus);
  const markUpdateNotified = useAppStore((state) => state.markUpdateNotified);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  const initialize = useVideoIndexStore((state) => state.initialize);
  const hasStartedMediaInitRef = useRef(false);

  useEffect(() => {
    SystemBars.setStyle(theme.dark ? 'light' : 'dark');
  }, [theme]);

  useEffect(() => {
    initializeApp();
  }, []);

  useEffect(() => {
    if (!appReady) {
      return;
    }

    refreshUpdateStatus();
  }, [appReady]);

  const [splashHidden, setSplashHidden] = useState(false);

  useEffect(() => {
    if (!updateStatus.available || updateStatus.notified || !updateStatus.latestVersion) {
      return;
    }
    if (!splashHidden) {
      return;
    }

    // Wait for the UI to fully settle after splash hides
    const timer = setTimeout(() => {
      setShowUpdateModal(true);
      markUpdateNotified();
    }, 800);

    return () => {
      clearTimeout(timer);
    };
  }, [
    updateStatus.available,
    updateStatus.notified,
    updateStatus.latestVersion,
    markUpdateNotified,
    splashHidden,
  ]);

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
      setSplashHidden(true);
    }
  }, [appReady, navReady]);

  async function initializeApp() {
    try {
      const subtitleCacheDir = FileService.getSubtitleCacheDir();
      await FileService.ensureDir(subtitleCacheDir);

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
          <UpdateModal
            visible={showUpdateModal}
            latestVersion={updateStatus.latestVersion}
            releaseNotes={updateStatus.releaseNotes}
            releaseUrl={updateStatus.releaseUrl}
            apkUrl={updateStatus.apkUrl}
            apkSha256Url={updateStatus.apkSha256Url}
            onDismiss={() => {
              setShowUpdateModal(false);
            }}
          />
        </ErrorBoundary>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

export default withStallion(App);
