import { create } from 'zustand';
import { AppSettings, HapticPreset, HapticSettings, ThemeMode } from '../types';
import { storage } from '../storage/storage';
import { setCrashReportsEnabled as setNativeCrashReports } from '../native/GlideNative';
import { IS_TV } from '../utils/tv';

// Registered in MainApplication from res/font/atkinson_hyperlegible_next.xml.
export const SUBTITLE_FONT_FAMILY = 'AtkinsonHyperlegibleNext';

/**
 * The presets are stops on the one strength slider (slider positions, dB scale: Subtle ~9%,
 * Cinematic ~25%, Intense full motion); the slider plays the preset of the nearest stop. Full
 * strength felt too strong on the Nothing Phone 2 (docs/haptics-decisions.md, Phase 6).
 */
export const HAPTIC_PRESETS: { key: HapticPreset; label: string; caption: string; strength: number }[] = [
    { key: 'subtle', label: 'Subtle', caption: 'Fewer, lighter', strength: 0.35 },
    { key: 'cinematic', label: 'Cinematic', caption: 'Default', strength: 0.6 },
    { key: 'intense', label: 'Intense', caption: 'More, stronger', strength: 1 },
];

/** Lowest slider stop: its loud moments sit just over the motor's felt floor. Off is the toggle. */
export const HAPTIC_STRENGTH_MIN = 0.1;

export const hapticPresetAt = (strength: number) =>
    HAPTIC_PRESETS.reduce((a, b) => (Math.abs(b.strength - strength) < Math.abs(a.strength - strength) ? b : a));

const DEFAULT_HAPTIC_SETTINGS: HapticSettings = {
    enabled: true,
    strength: 0.6,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
    // TV starts dark (owner, 2026-10-23): a dim room, and TVs report light. Settings can change it.
    darkMode: IS_TV ? 'dark' : 'system',
    hapticSettings: DEFAULT_HAPTIC_SETTINGS,
    subtitleFontSize: 20,
    subtitleColor: '#FFFFFF',
    subtitleFontWeight: 600,
    subtitleOutlineWidth: 2,
    subtitleBackgroundColor: 'transparent',
    subtitleBackgroundOpacity: 0.5,
    subtitleEdgeStyle: 'outline',
    subtitleFontFamily: SUBTITLE_FONT_FAMILY,
    subtitlePositionPortrait: 0.38,
    subtitlePositionLandscape: 0.38,
    hasCompletedOnboarding: false,
    brightnessMode: 'video',
    pipBrightnessMode: 'system',
    globalBrightness: 0.5,
    showSeekButtons: true,
    seekDuration: 10,
    autoPlayNext: false,
    volumeLevelerDefault: false,
    defaultAudioLanguage: null,
    shakeThreshold: 1.2,
    shakeEnabled: false,
    shakeAction: 'play_pause',
    onlineLyricsEnabled: true,
    crashReportsEnabled: true,
};

export function migrateSettings(settings: AppSettings): AppSettings {
    // Older builds stored dark mode as a boolean.
    const darkMode = settings?.darkMode as ThemeMode | boolean | undefined;
    const merged = {
        ...DEFAULT_APP_SETTINGS,
        ...settings,
        darkMode: typeof darkMode === 'boolean' ? (darkMode ? 'dark' : 'light') : darkMode ?? DEFAULT_APP_SETTINGS.darkMode,
        // Older builds stored a 1-255 `intensity`, which the presets replaced.
        hapticSettings: {
            enabled: settings?.hapticSettings?.enabled ?? DEFAULT_HAPTIC_SETTINGS.enabled,
            strength: Math.max(HAPTIC_STRENGTH_MIN, settings?.hapticSettings?.strength ?? DEFAULT_HAPTIC_SETTINGS.strength),
        },
    };

    return {
        ...merged,
        subtitlePositionPortrait: typeof merged.subtitlePositionPortrait === 'number'
            ? merged.subtitlePositionPortrait
            : DEFAULT_APP_SETTINGS.subtitlePositionPortrait,
        subtitlePositionLandscape: typeof merged.subtitlePositionLandscape === 'number'
            ? merged.subtitlePositionLandscape
            : DEFAULT_APP_SETTINGS.subtitlePositionLandscape,
        // Netflix Sans was removed (not licensed for redistribution).
        subtitleFontFamily: merged.subtitleFontFamily?.startsWith('NetflixSans')
            ? SUBTITLE_FONT_FAMILY
            : merged.subtitleFontFamily,
    };
}

function loadInitialSettings(): AppSettings {
    try {
        const saved = storage.loadSettings();
        if (saved) {
            return migrateSettings(saved);
        }
    } catch {
        // Fallback to defaults
    }
    return DEFAULT_APP_SETTINGS;
}

interface AppStore {
    settings: AppSettings;
    updateSettings: (settings: Partial<AppSettings>) => void;
    toggleHaptics: () => void;
    setSubtitlePosition: (orientation: 'portrait' | 'landscape', offsetRatio: number) => void;
    resetSubtitleSettings: () => void;
    completeOnboarding: () => void;
    setHapticStrength: (strength: number) => void;
    setCrashReportsEnabled: (enabled: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
    settings: loadInitialSettings(),
    updateSettings: (newSettings) =>
        set((state) => ({
            settings: { ...state.settings, ...newSettings },
        })),
    toggleHaptics: () =>
        set((state) => ({
            settings: {
                ...state.settings,
                hapticSettings: {
                    ...state.settings.hapticSettings,
                    enabled: !state.settings.hapticSettings.enabled,
                },
            },
        })),
    setSubtitlePosition: (orientation, offsetRatio) =>
        set((state) => {
            const clampedOffset = Math.max(-0.45, Math.min(0.45, offsetRatio));
            return {
                settings: {
                    ...state.settings,
                    ...(orientation === 'landscape'
                        ? { subtitlePositionLandscape: clampedOffset }
                        : { subtitlePositionPortrait: clampedOffset }),
                },
            };
        }),
    resetSubtitleSettings: () =>
        set((state) => ({
            settings: {
                ...state.settings,
                subtitleFontSize: 20,
                subtitleColor: '#FFFFFF',
                subtitleFontWeight: 600,
                subtitleOutlineWidth: 2,
                subtitleBackgroundColor: 'transparent',
                subtitleBackgroundOpacity: 0.5,
                subtitleEdgeStyle: 'outline',
                subtitleFontFamily: SUBTITLE_FONT_FAMILY,
                subtitlePositionPortrait: 0.38,
                subtitlePositionLandscape: 0.38,
            },
        })),
    completeOnboarding: () =>
        set((state) => ({
            settings: { ...state.settings, hasCompletedOnboarding: true },
        })),
    setHapticStrength: (strength) =>
        set((state) => ({
            settings: {
                ...state.settings,
                hapticSettings: { ...state.settings.hapticSettings, strength },
            },
        })),
    setCrashReportsEnabled: (enabled) => {
        // Native keeps its own copy: ACRA has to know before any JS runs.
        setNativeCrashReports(enabled);
        set((state) => ({
            settings: { ...state.settings, crashReportsEnabled: enabled },
        }));
    },
}));

// Automatically persist settings to MMKV whenever they change
useAppStore.subscribe((state, prevState) => {
    if (state.settings !== prevState.settings) {
        storage.saveSettings(state.settings);
    }
});

