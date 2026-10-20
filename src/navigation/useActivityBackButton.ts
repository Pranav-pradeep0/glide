import { RefObject, useEffect } from 'react';
import { BackHandler } from 'react-native';
import type { NavigationContainerRef } from '@react-navigation/native';
import { currentActivityName } from '@/native/PipModule';

/**
 * NavigationContainer's Back handling, limited to one Activity; use with BaseNavigationContainer,
 * which has none. Both Activities share one JS runtime and one Back handler list, so the stock
 * handler popped its stack whichever Activity Back was pressed in: Back in the library sent an
 * "Open with" video in PiP to its detail screen, and Back on that screen popped the hidden library.
 */
export function useActivityBackButton(ref: RefObject<NavigationContainerRef<any> | null>, activity: string) {
    useEffect(() => {
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            const front = currentActivityName();
            // Undefined on APKs without the method: behave as the stock handler.
            if (front != null && front !== activity) { return false; }
            const nav = ref.current;
            if (nav?.canGoBack()) {
                nav.goBack();
                return true;
            }
            return false;
        });
        return () => sub.remove();
    }, [ref, activity]);
}
