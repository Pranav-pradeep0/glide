import { useColorScheme } from 'react-native';
import { useAppStore } from '../store/appStore';
import { darkTheme, lightTheme, Theme } from '@/theme/theme';

export function useTheme(): Theme {
    const mode = useAppStore((state) => state.settings.darkMode);
    const system = useColorScheme();
    const dark = mode === 'system' ? system === 'dark' : mode === 'dark';
    return dark ? darkTheme : lightTheme;
}
