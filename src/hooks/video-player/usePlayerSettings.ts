/**
 * usePlayerSettings Hook
 *
 * Manages player settings like mute, repeat, resize mode, and sleep timer.
 */

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { PlayerResizeMode } from '@/components/VideoPlayer/GlidePlayer';
import { PlayerSettings, UsePlayerSettingsReturn } from './types';
import { EQUALIZER_PRESETS } from '@/config/equalizerPresets';

// ============================================================================
// TYPES
// ============================================================================

interface UsePlayerSettingsOptions {
    onSleepTimerEnd?: () => void;
    showToast?: (message: string, icon?: string) => void;
    initialAudioDelay?: number;
    initialSubtitleDelay?: number;
    /** The previous video's settings, when Next / Previous / autoplay opened this one. */
    carried?: PlayerSettings;
}


// ============================================================================
// INITIAL STATE
// ============================================================================

const initialSettings: PlayerSettings = {
    muted: false,
    repeat: false,
    sleepTimer: null,
    sleepTimerEndsAt: null,
    resizeMode: 'contain',
    skipDuration: 30,
    backgroundPlayEnabled: false,
    videoEnhancement: false,
    videoEnhancementStrength: 1,

    // Equalizer defaults
    equalizerEnabled: false,
    equalizerPreset: 'flat',
    customEqualizerBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],

    // Synchronization defaults
    audioDelay: 0,
    subtitleDelay: 0,

    // Subtitle defaults
    subtitleFontSize: 20,
    subtitleColor: '#FFFFFF',
    subtitleFontWeight: 600, // Semi-bold default
    subtitleOutlineWidth: 2, // Default outline width
    subtitleBackgroundColor: 'transparent',
    subtitleBackgroundOpacity: 0.5,
    subtitleEdgeStyle: 'outline',
};

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for managing player settings.
 *
 * Settings include:
 * - Mute toggle
 * - Repeat mode
 * - Resize mode
 * - Sleep timer
 */
export function usePlayerSettings(options: UsePlayerSettingsOptions = {}): UsePlayerSettingsReturn {
    const {
        onSleepTimerEnd,
        showToast,
        initialAudioDelay = 0,
        initialSubtitleDelay = 0,
        carried,
    } = options;

    const [settings, setSettings] = useState<PlayerSettings>({
        ...(carried ?? initialSettings),
        audioDelay: initialAudioDelay,
        subtitleDelay: initialSubtitleDelay,
    });

    const sleepTimerRef = useRef<NodeJS.Timeout | null>(null);
    const onSleepTimerEndRef = useRef(onSleepTimerEnd);
    onSleepTimerEndRef.current = onSleepTimerEnd;

    const armSleepTimer = useCallback((endsAt: number) => {
        sleepTimerRef.current = setTimeout(() => {
            if (__DEV__) { console.log('[usePlayerSettings] Sleep timer triggered'); }
            onSleepTimerEndRef.current?.();
        }, endsAt - Date.now());
    }, []);

    // A timer carried from the previous video keeps its original end time.
    useEffect(() => {
        if (settings.sleepTimerEndsAt !== null) { armSleepTimer(settings.sleepTimerEndsAt); }
        return () => {
            if (sleepTimerRef.current) {
                clearTimeout(sleepTimerRef.current);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
    }, []);

    // ========================================================================
    // MUTE
    // ========================================================================

    const toggleMute = useCallback(() => {
        setSettings(prev => ({
            ...prev,
            muted: !prev.muted,
        }));
    }, []);

    // ========================================================================
    // REPEAT
    // ========================================================================

    const toggleRepeat = useCallback(() => {
        setSettings(prev => ({
            ...prev,
            repeat: !prev.repeat,
        }));
    }, []);

    // ========================================================================
    // DECODER
    // ========================================================================

    // ========================================================================
    // RESIZE MODE
    // ========================================================================

    const setResizeMode = useCallback((mode: PlayerResizeMode) => {
        setSettings(prev => ({
            ...prev,
            resizeMode: mode,
        }));
    }, []);

    // ========================================================================
    // SLEEP TIMER
    // ========================================================================

    const clearSleepTimer = useCallback(() => {
        if (sleepTimerRef.current) {
            clearTimeout(sleepTimerRef.current);
            sleepTimerRef.current = null;
        }
    }, []);

    const setSleepTimer = useCallback((minutes: number | null) => {
        // Clear existing timer
        clearSleepTimer();

        const endsAt = minutes !== null && minutes > 0 ? Date.now() + minutes * 60_000 : null;
        setSettings(prev => ({
            ...prev,
            sleepTimer: minutes,
            sleepTimerEndsAt: endsAt,
        }));

        if (endsAt !== null) {
            armSleepTimer(endsAt);
            showToast?.(`Sleep timer set for ${minutes} minutes`);
        } else if (minutes === -1) {
            // End of video - handled in player's onEnd
            showToast?.('Sleep timer set for End of Video');
        } else {
            showToast?.('Sleep timer disabled');
        }
    }, [clearSleepTimer, armSleepTimer, showToast]);

    // ========================================================================
    // BACKGROUND PLAY
    // ========================================================================

    const toggleBackgroundPlay = useCallback(() => {
        const newValue = !settings.backgroundPlayEnabled;

        // Marked experimental until the Media3 foreground service exists (tracker §9).
        // Playback is owned by the Activity, so Android can reclaim it while backgrounded,
        // and from target SDK 35 it refuses audio focus to a background app outright.
        showToast?.(newValue ? 'Background play on · experimental' : 'Background play off');
        setSettings(prev => ({
            ...prev,
            backgroundPlayEnabled: newValue,
        }));
    }, [settings.backgroundPlayEnabled, showToast]);

    // ========================================================================
    // VIDEO ENHANCEMENT
    // ========================================================================

    const toggleVideoEnhancement = useCallback(() => {
        setSettings(prev => {
            const newValue = !prev.videoEnhancement;
            const message = newValue
                ? 'Color Enhancement Enabled'
                : 'Color Enhancement Disabled';

            showToast?.(message);

            return {
                ...prev,
                videoEnhancement: newValue,
            };
        });
    }, [showToast]);

    const setVideoEnhancementStrength = useCallback((strength: number) => {
        setSettings(prev => ({ ...prev, videoEnhancementStrength: strength }));
    }, []);

    // ========================================================================
    // EQUALIZER
    // ========================================================================

    const toggleEqualizer = useCallback(() => {
        setSettings(prev => ({
            ...prev,
            equalizerEnabled: !prev.equalizerEnabled,
        }));
    }, []);

    const setEqualizerPreset = useCallback((presetId: string) => {
        setSettings(prev => {
            const preset = EQUALIZER_PRESETS.find(p => p.id === presetId);
            let newCustomBands = prev.customEqualizerBands;
            if (preset && presetId !== 'custom' && presetId !== 'flat') {
                newCustomBands = [...preset.values];
            }

            return {
                ...prev,
                equalizerPreset: presetId,
                customEqualizerBands: newCustomBands,
                equalizerEnabled: presetId === 'flat' ? false : true,
            };
        });
    }, []);

    const setCustomEqualizerBands = useCallback((bands: number[]) => {
        setSettings(prev => ({
            ...prev,
            customEqualizerBands: bands,
            equalizerPreset: 'custom',
            equalizerEnabled: true,
        }));
    }, []);

    const setSingleBand = useCallback((index: number, value: number) => {
        setSettings(prev => {
            const newBands = [...prev.customEqualizerBands];
            newBands[index] = value;
            return {
                ...prev,
                customEqualizerBands: newBands,
                equalizerPreset: 'custom',
                equalizerEnabled: true,
            };
        });
    }, []);

    // ========================================================================
    // SYNCHRONIZATION
    // ========================================================================

    const setAudioDelay = useCallback((delay: number) => {
        setSettings(prev => ({ ...prev, audioDelay: delay }));
    }, []);

    const setSubtitleDelay = useCallback((delay: number) => {
        setSettings(prev => ({ ...prev, subtitleDelay: delay }));
    }, []);

    // Compute effective bands for player
    const audioEqualizer = useMemo(() => {
        if (!settings.equalizerEnabled) { return undefined; }

        if (settings.equalizerPreset === 'custom') {
            return settings.customEqualizerBands;
        }

        const preset = EQUALIZER_PRESETS.find(p => p.id === settings.equalizerPreset);
        return preset ? preset.values : undefined;
    }, [settings.equalizerEnabled, settings.equalizerPreset, settings.customEqualizerBands]);

    // ========================================================================
    // RETURN
    // ========================================================================

    return useMemo(() => ({
        settings,
        toggleMute,
        toggleRepeat,
        setResizeMode,
        setSleepTimer,
        clearSleepTimer,
        toggleBackgroundPlay,
        toggleVideoEnhancement,
        setVideoEnhancementStrength,

        // Equalizer
        toggleEqualizer,
        setEqualizerPreset,
        setCustomEqualizerBands,
        setSingleBand,
        audioEqualizer,

        // Synchronization
        setAudioDelay,
        setSubtitleDelay,
    }), [
        settings,
        toggleMute, toggleRepeat,
        setResizeMode,
        setSleepTimer, clearSleepTimer,
        toggleBackgroundPlay, toggleVideoEnhancement, setVideoEnhancementStrength,
        toggleEqualizer, setEqualizerPreset, setCustomEqualizerBands, setSingleBand, audioEqualizer,
        setAudioDelay, setSubtitleDelay,
    ]);
}

export default usePlayerSettings;


