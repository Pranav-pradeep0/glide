import { create } from 'zustand';
import { Appearance } from 'react-native';
import { AppSettings, HapticPreset, HapticSettings, ShakeAction } from '../types';
import type { UpdateError } from '../hooks/useUpdateInstaller';
import { updateStorage, type UpdateApkCache } from '../storage/updateStorage';
import { storage } from '../storage/storage';

/**
 * The update UI appears in two places at once: the app-level UpdateModal and the
 * Settings update card. Both drive the same download and the same cached file, so the
 * progress, status, and error live here rather than in each component's own state.
 */
export interface UpdateInstallState {
    isDownloading: boolean;
    downloadProgress: number | null;
    error: UpdateError | null;
    cachedApk: UpdateApkCache | null;
}

const INITIAL_UPDATE_INSTALL: UpdateInstallState = {
    isDownloading: false,
    downloadProgress: null,
    error: null,
    cachedApk: null,
};

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

export const DEFAULT_HAPTIC_SETTINGS: HapticSettings = {
    enabled: true,
    strength: 0.6,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
    darkMode: false,
    hapticSettings: DEFAULT_HAPTIC_SETTINGS,
    autoDownloadSubtitles: true,
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
    defaultAudioLanguage: null,
    shakeThreshold: 1.2,
    shakeEnabled: false,
    shakeAction: 'play_pause',
    onlineLyricsEnabled: true,
};

export function migrateSettings(settings: AppSettings): AppSettings {
    const merged = {
        ...DEFAULT_APP_SETTINGS,
        ...settings,
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

export function loadInitialSettings(): AppSettings {
    const systemDark = Appearance.getColorScheme() === 'dark';
    try {
        const saved = storage.loadSettings();
        if (saved) {
            const migrated = migrateSettings(saved);
            if (migrated.darkMode === undefined || migrated.darkMode === null) {
                return { ...migrated, darkMode: systemDark };
            }
            return migrated;
        }
    } catch {
        // Fallback to defaults
    }
    return { ...DEFAULT_APP_SETTINGS, darkMode: systemDark };
}

interface AppStore {
    settings: AppSettings;
    updateStatus: {
        available: boolean;
        latestVersion: string | null;
        releaseUrl: string | null;
        releaseNotes: string | null;
        apkUrl: string | null;
        apkSha256Url: string | null;
        lastCheckedAt: number | null;
        seen: boolean;
        notified: boolean;
    };
    updateInstall: UpdateInstallState;
    setUpdateInstall: (patch: Partial<UpdateInstallState>) => void;
    updateSettings: (settings: Partial<AppSettings>) => void;
    toggleDarkMode: () => void;
    toggleHaptics: () => void;
    toggleAutoDownloadSubtitles: () => void;
    setSubtitleFontSize: (size: number) => void;
    setSubtitleColor: (color: string) => void;
    setSubtitleFontWeight: (weight: number) => void;
    setSubtitleOutlineWidth: (width: number) => void;
    setSubtitleBackgroundColor: (color: string) => void;
    setSubtitleBackgroundOpacity: (opacity: number) => void;
    setSubtitleEdgeStyle: (style: 'none' | 'outline' | 'dropShadow') => void;
    setSubtitleFontFamily: (fontFamily: string) => void;
    setSubtitlePosition: (orientation: 'portrait' | 'landscape', offsetRatio: number) => void;
    resetSubtitleSettings: () => void;
    completeOnboarding: () => void;
    setHapticStrength: (strength: number) => void;

    // Brightness settings
    setBrightnessMode: (mode: 'global' | 'video') => void;
    setPipBrightnessMode: (mode: 'system' | 'player') => void;
    setGlobalBrightness: (brightness: number) => void;

    // Playback settings
    setShowSeekButtons: (show: boolean) => void;
    setSeekDuration: (duration: number) => void;

    setAutoPlayNext: (enabled: boolean) => void;
    setDefaultAudioLanguage: (language: string | null) => void;
    setShakeThreshold: (threshold: number) => void;
    setShakeEnabled: (enabled: boolean) => void;
    setShakeAction: (action: ShakeAction) => void;
    setOnlineLyricsEnabled: (enabled: boolean) => void;

    // Update actions
    setUpdateStatus: (data: {
        available: boolean;
        latestVersion: string | null;
        releaseUrl: string | null;
        releaseNotes: string | null;
        apkUrl: string | null;
        apkSha256Url: string | null;
    }) => void;
    markUpdateSeen: () => void;
    markUpdateNotified: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
    settings: loadInitialSettings(),
    updateStatus: {
        available: false,
        latestVersion: null,
        releaseUrl: null,
        releaseNotes: null,
        apkUrl: null,
        apkSha256Url: null,
        lastCheckedAt: null,
        seen: false,
        notified: false,
    },
    updateInstall: INITIAL_UPDATE_INSTALL,
    setUpdateInstall: (patch) =>
        set((state) => ({ updateInstall: { ...state.updateInstall, ...patch } })),
    updateSettings: (newSettings) =>
        set((state) => ({
            settings: { ...state.settings, ...newSettings },
        })),
    toggleDarkMode: () =>
        set((state) => ({
            settings: { ...state.settings, darkMode: !state.settings.darkMode },
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
    toggleAutoDownloadSubtitles: () =>
        set((state) => ({
            settings: {
                ...state.settings,
                autoDownloadSubtitles: !state.settings.autoDownloadSubtitles,
            },
        })),
    setSubtitleFontSize: (size) =>
        set((state) => ({
            settings: { ...state.settings, subtitleFontSize: size },
        })),
    setSubtitleColor: (color) =>
        set((state) => ({
            settings: { ...state.settings, subtitleColor: color },
        })),
    setSubtitleFontWeight: (weight) =>
        set((state) => ({
            settings: { ...state.settings, subtitleFontWeight: weight },
        })),
    setSubtitleOutlineWidth: (width) =>
        set((state) => ({
            settings: { ...state.settings, subtitleOutlineWidth: width },
        })),
    setSubtitleBackgroundColor: (color) =>
        set((state) => ({
            settings: { ...state.settings, subtitleBackgroundColor: color },
        })),
    setSubtitleBackgroundOpacity: (opacity) =>
        set((state) => ({
            settings: { ...state.settings, subtitleBackgroundOpacity: opacity },
        })),
    setSubtitleEdgeStyle: (style) =>
        set((state) => ({
            settings: { ...state.settings, subtitleEdgeStyle: style },
        })),
    setSubtitleFontFamily: (fontFamily) =>
        set((state) => ({
            settings: { ...state.settings, subtitleFontFamily: fontFamily },
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

    // Brightness actions
    setBrightnessMode: (mode) =>
        set((state) => ({
            settings: { ...state.settings, brightnessMode: mode },
        })),
    setPipBrightnessMode: (mode) =>
        set((state) => ({
            settings: { ...state.settings, pipBrightnessMode: mode },
        })),
    setGlobalBrightness: (brightness) =>
        set((state) => ({
            settings: { ...state.settings, globalBrightness: brightness },
        })),

    // Playback settings
    setShowSeekButtons: (show) =>
        set((state) => ({
            settings: { ...state.settings, showSeekButtons: show },
        })),
    setSeekDuration: (duration) =>
        set((state) => ({
            settings: { ...state.settings, seekDuration: duration },
        })),
    setAutoPlayNext: (enabled) =>
        set((state) => ({
            settings: { ...state.settings, autoPlayNext: enabled },
        })),
    setDefaultAudioLanguage: (language) =>
        set((state) => ({
            settings: { ...state.settings, defaultAudioLanguage: language },
        })),
    setShakeThreshold: (threshold) =>
        set((state) => ({
            settings: { ...state.settings, shakeThreshold: threshold },
        })),
    setShakeEnabled: (enabled) =>
        set((state) => ({
            settings: { ...state.settings, shakeEnabled: enabled },
        })),
    setShakeAction: (action) =>
        set((state) => ({
            settings: { ...state.settings, shakeAction: action },
        })),
    setOnlineLyricsEnabled: (enabled) =>
        set((state) => ({
            settings: { ...state.settings, onlineLyricsEnabled: enabled },
        })),

    setUpdateStatus: (data) =>
        set((state) => {
            return {
                updateStatus: {
                    ...state.updateStatus,
                    ...data,
                    lastCheckedAt: Date.now(),
                    seen: data.available ? false : state.updateStatus.seen,
                    // Kept across launches: a release is announced once, not on every cold start.
                    notified: data.available && data.latestVersion !== null
                        && updateStorage.notifiedVersion() === data.latestVersion,
                },
            };
        }),
    markUpdateSeen: () =>
        set((state) => ({
            updateStatus: {
                ...state.updateStatus,
                seen: true,
            },
        })),
    markUpdateNotified: () =>
        set((state) => {
            if (state.updateStatus.latestVersion) { updateStorage.setNotifiedVersion(state.updateStatus.latestVersion); }
            return { updateStatus: { ...state.updateStatus, notified: true } };
        }),
}));

// Automatically persist settings to MMKV whenever they change
useAppStore.subscribe((state, prevState) => {
    if (state.settings !== prevState.settings) {
        storage.saveSettings(state.settings);
    }
});

