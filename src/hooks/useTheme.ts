import { useAppStore } from '../store/appStore';
import { darkTheme, lightTheme, Theme } from '@/theme/theme';

export function useTheme(): Theme {
    const darkMode = useAppStore((state) => state.settings.darkMode);
    return darkMode ? darkTheme : lightTheme;
}
