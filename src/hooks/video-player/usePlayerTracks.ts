/**
 * usePlayerTracks Hook
 *
 * Manages audio and subtitle track selection, subtitle cue parsing,
 * and external subtitle handling.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SubtitleExtractor, SubtitleTrack } from '@/utils/SubtitleExtractor';
import { SubtitleCue } from '@/types';
import {
    NativeAudioTrack,
    ExternalSubtitle,
    UsePlayerTracksReturn,
} from './types';
import { findMatchingAudioTrack } from '@/utils/languages';
import { SubtitleCueStore } from '@/services/SubtitleCueStore';
import { useSubtitleCueStore } from '@/store/subtitleCueStore';
import { EXTERNAL_SUBTITLE_INDEX, loadExternalSubtitle, saveExternalSubtitle } from '@/services/ExternalSubtitleStore';
import { SubtitleSelectionService } from '@/services/SubtitleSelectionService';
import { SubtitlePickerService } from '@/services/SubtitlePickerService';
import { searchSDHSubtitles, downloadSubtitle } from '@/utils/subdlApi';
import { isAbortError } from '@/utils/network';

/** A cue that can carry a sound tag ([explosion], (footsteps), ♪); native reads the tags (HapticMeaning). */
export const hasSoundTag = (text: string) => /[[(♪♫]/.test(text);
const tagCount = (cues: SubtitleCue[]) => cues.reduce((n, c) => n + (hasSoundTag(c.text) ? 1 : 0), 0);

// The SDH subtitle found for each video (null: none), so playing it again has the tags at once.
// ponytail: in memory, last 10 videos; persist it if a cold start should skip the search too.
const sdhFound = new Map<string, SubtitleCue[] | null>();

/** Embedded tracks, then subtitle files beside the video, then online. Null when none is SDH. */
async function findSDHCues(videoPath: string, videoName: string, imdbId: string | undefined, signal: AbortSignal) {
    const stopIfAborted = () => {
        if (signal.aborted) { throw Object.assign(new Error('SDH search stopped'), { name: 'AbortError' }); }
    };
    const tracks = await SubtitleCueStore.getTracks(videoPath);
    stopIfAborted();
    if (tracks.length > 0) {
        const found = await SubtitleSelectionService.findBestSDHByContent(tracks, async (index) => {
            stopIfAborted();
            return SubtitleCueStore.getCues(videoPath, index);
        }, 'en');
        if (found) { return found.cues; }
    }
    for (const path of await SubtitlePickerService.findMatchingSubtitles(videoPath)) {
        stopIfAborted();
        const picked = await SubtitlePickerService.loadFromPath(path);
        if (picked && SubtitleSelectionService.validateSDHContent(picked.cues).isSDH) { return picked.cues; }
    }
    stopIfAborted();
    const { subtitles } = await searchSDHSubtitles(videoName, 'en', imdbId, signal);
    const best = subtitles.find(s => s.hearingImpaired || (s.sdhScore ?? 0) > 5);
    return best ? downloadSubtitle(best.downloadUrl, signal) : null;
}

// ============================================================================
// TYPES
// ============================================================================

interface UsePlayerTracksOptions {
    videoPath: string;
    currentTimeRef: React.MutableRefObject<number>;

    /** Look for an SDH subtitle in the background and hand its tags to haptics. */
    findHapticCues?: boolean;
    videoName?: string;
    imdbId?: string;
    initialAudioTrackId?: number;
    initialSubtitleTrackIndex?: number;

    subtitleDelay?: number; // in milliseconds
    defaultAudioLanguage?: string | null;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for managing audio and subtitle tracks.
 *
 * Features:
 * - Audio track loading from player onLoad
 * - Embedded subtitle track extraction via FFmpeg
 * - External subtitle file loading
 * - API subtitle support
 * - Current cue tracking for display
 * - SDH cues for haptic feedback
 */
export function usePlayerTracks(options: UsePlayerTracksOptions): UsePlayerTracksReturn {
    const { videoPath, currentTimeRef, findHapticCues, videoName, imdbId, initialAudioTrackId, initialSubtitleTrackIndex, subtitleDelay = 0, defaultAudioLanguage } = options;

    // ========================================================================
    // STATE
    // ========================================================================

    // Audio
    const [audioTracks, setAudioTracks] = useState<NativeAudioTrack[]>([]);
    const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<number | undefined>(initialAudioTrackId);

    // Sync initial audio track when it becomes available (hydration)
    useEffect(() => {
        if (initialAudioTrackId !== undefined && selectedAudioTrackId === undefined) {
            setSelectedAudioTrackId(initialAudioTrackId);
        }
    }, [initialAudioTrackId]);

    // Subtitles
    const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
    const [subtitleTracksReady, setSubtitleTracksReady] = useState(false);
    /** An embedded text track is being read out of the file; its cues are on the way. */
    const [subtitleCuesLoading, setSubtitleCuesLoading] = useState(false);
    const [selectedSubtitleTrackIndex, setSelectedSubtitleTrackIndex] = useState<number | null>(initialSubtitleTrackIndex ?? null);

    // Sync initial subtitle track when it becomes available (hydration)
    useEffect(() => {
        if (initialSubtitleTrackIndex !== undefined && selectedSubtitleTrackIndex === null) {
            setSelectedSubtitleTrackIndex(initialSubtitleTrackIndex);
        }
    }, [initialSubtitleTrackIndex]);


    const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);

    /**
     * Which subtitle track the native player should decode, as an **ordinal among subtitle
     * streams** — not ffmpeg's `index`, which counts video and audio streams too and so
     * would address the wrong track (or none).
     *
     * Only ever set for bitmap subtitles. Text subtitles come from the ffmpeg extraction
     * path, which haptics and negative subtitle delay both depend on.
     */
    const nativeTextTrackOrdinal = useMemo(() => {
        if (selectedSubtitleTrackIndex === null || selectedSubtitleTrackIndex === EXTERNAL_SUBTITLE_INDEX) {
            return -1;
        }
        const ordinal = subtitleTracks.findIndex(t => t.index === selectedSubtitleTrackIndex);
        if (ordinal < 0) {
            return -1;
        }
        if (subtitleTracks[ordinal]?.isBitmap || subtitleCues.length === 0) {
            return ordinal;
        }
        return -1;
    }, [selectedSubtitleTrackIndex, subtitleTracks, subtitleCues]);

    // External subtitles
    const [externalSubtitles, setExternalSubtitles] = useState<ExternalSubtitle[]>([]);
    const [currentExternalName, setCurrentExternalName] = useState<string | null>(null);

    // Haptic cues: sound alone drives haptics; a subtitle's sound tags only shape them.
    // Found automatically (background search, an embedded track), the one with more tags wins.
    const [hapticCues, setHapticCues] = useState<SubtitleCue[]>(() => sdhFound.get(videoPath) ?? []);
    const offerHapticCues = useCallback((cues: SubtitleCue[]) => {
        setHapticCues(prev => (tagCount(cues) > tagCount(prev) ? cues : prev));
    }, []);

    useEffect(() => {
        if (!findHapticCues || !videoName || sdhFound.has(videoPath)) {return;}
        const abort = new AbortController();
        findSDHCues(videoPath, videoName, imdbId, abort.signal).then(cues => {
            sdhFound.set(videoPath, cues);
            if (sdhFound.size > 10) {sdhFound.delete(sdhFound.keys().next().value!);}
            if (cues && !abort.signal.aborted) {offerHapticCues(cues);}
        }).catch(error => {
            if (!isAbortError(error)) {console.warn('[usePlayerTracks] SDH search failed:', error);}
        });
        return () => abort.abort();
    }, [findHapticCues, videoPath, videoName, imdbId, offerHapticCues]);

    // Refs
    const extractedSubtitlePathRef = useRef<string | null>(null);

    // ========================================================================
    // AUDIO TRACK HANDLING
    // ========================================================================

    /**
     * Set audio tracks from player onLoad event.
     * Called by parent component when native player reports available tracks.
     */
    const setAudioTracksFromNative = useCallback((tracks: NativeAudioTrack[]) => {
        setAudioTracks(tracks);
        // Select first track by default if not already selected AND no initial selection was provided
        // (If initialAudioTrackId was provided, selectedAudioTrackId is already set to it)
        if (selectedAudioTrackId === undefined && tracks.length > 0) {
            // Check for preferred language using smart matching
            if (defaultAudioLanguage) {
                const matchedTrackId = findMatchingAudioTrack(tracks, defaultAudioLanguage);
                if (matchedTrackId !== undefined) {
                    if (__DEV__) {console.log('[usePlayerTracks] Auto-selecting audio track:', matchedTrackId, 'for preference:', defaultAudioLanguage);}
                    setSelectedAudioTrackId(matchedTrackId);
                    return;
                }
            }

            // Prefer the track selected by the native player (e.g. matching device language)
            const activeTrack = tracks.find(t => t.isSelected);
            if (activeTrack !== undefined) {
                if (__DEV__) {console.log('[usePlayerTracks] Using player-selected audio track:', activeTrack.id, activeTrack.name);}
                setSelectedAudioTrackId(activeTrack.id);
                return;
            }

            // Fallback to first track
            setSelectedAudioTrackId(tracks[0].id);
        }
    }, [selectedAudioTrackId, defaultAudioLanguage]);

    const selectAudioTrack = useCallback((trackId: number | null) => {
        setSelectedAudioTrackId(trackId === null ? undefined : trackId);
        if (__DEV__) {
            if (__DEV__) {console.log('[usePlayerTracks] Audio track selected:', trackId);}
        }
    }, []);

    // ========================================================================
    // EMBEDDED SUBTITLE HANDLING
    // ========================================================================

    // Load embedded subtitle tracks on mount
    useEffect(() => {
        let mounted = true;
        setSubtitleTracksReady(false);

        const loadSubtitleTracks = async () => {
            try {
                const tracks = await SubtitleCueStore.getTracks(videoPath);
                if (mounted && tracks.length > 0) {
                    setSubtitleTracks(tracks);
                    if (__DEV__) {
                        if (__DEV__) {console.log('[usePlayerTracks] Extracted subtitle tracks:', tracks.length);}
                    }
                }
            } catch (error) {
                if (__DEV__) {
                    console.error('[usePlayerTracks] Failed to load subtitle tracks:', error);
                }
            } finally {
                if (mounted) {setSubtitleTracksReady(true);}
            }
        };

        loadSubtitleTracks();

        return () => {
            mounted = false;
        };
    }, [videoPath]);

    const setSubtitleTracksFromPlayer = useCallback((tracks: SubtitleTrack[]) => {
        if (tracks && tracks.length > 0) {
            setSubtitleTracks(tracks);
            setSubtitleTracksReady(true);
        }
    }, []);

    // Extract and parse selected subtitle track
    useEffect(() => {
        let mounted = true;

        const extractSubtitle = async () => {
            // No subtitle selected
            if (selectedSubtitleTrackIndex === null) {
                setSubtitleCues([]);
                return;
            }

            // External subtitle
            if (selectedSubtitleTrackIndex === EXTERNAL_SUBTITLE_INDEX) {
                // Cues already set by loadExternalCues
                return;
            }

            // Bitmap subtitles (PGS, VobSub) are decoded and rendered natively by Media3's
            // SubtitleView over the video surface. ffmpeg cannot give us text for them, so
            // the extraction path below is skipped entirely.
            const selectedTrack = subtitleTracks.find(t => t.index === selectedSubtitleTrackIndex);
            if (selectedTrack && selectedTrack.isBitmap) {
                if (__DEV__) {console.log(`[usePlayerTracks] Bitmap subtitle (${selectedTrack.codec}) — rendering natively`);}
                setSubtitleCues([]);
                return;
            }

            setSubtitleCuesLoading(true);
            try {
                const cues = await SubtitleCueStore.getCues(videoPath, selectedSubtitleTrackIndex);
                if (!mounted) {return;}

                if (cues && cues.length > 0) {
                    setSubtitleCues(cues);
                    offerHapticCues(cues);
                    if (__DEV__) {
                        if (__DEV__) {console.log(`[usePlayerTracks] Subtitle loaded: ${cues.length} cues`);}
                    }
                } else if (mounted) {
                    setSubtitleCues([]);
                }
            } catch (error) {
                if (__DEV__) {
                    console.error('[usePlayerTracks] Failed to load cues from store:', error);
                }
                if (mounted) {
                    setSubtitleCues([]);
                }
            } finally {
                if (mounted) {setSubtitleCuesLoading(false);}
            }
        };

        extractSubtitle();

        return () => {
            mounted = false;
            setSubtitleCuesLoading(false);
        };
    }, [selectedSubtitleTrackIndex, videoPath, subtitleTracks, offerHapticCues]);

    // Nothing is evicted on unmount. SubtitleCueStore is an LRU of five videos, and that
    // is the memory bound; evicting here threw away the very entry it exists to keep, so
    // going back into a video you just left re-extracted its subtitles from scratch.

    const selectSubtitleTrack = useCallback((trackIndex: number | null) => {
        setSelectedSubtitleTrackIndex(trackIndex);
        // Clear external name if selecting embedded track
        if (trackIndex !== EXTERNAL_SUBTITLE_INDEX) {
            setCurrentExternalName(null);
        }
        if (__DEV__) {
            if (__DEV__) {console.log('[usePlayerTracks] Subtitle track selected:', trackIndex);}
        }
    }, []);

    // ========================================================================
    // EXTERNAL SUBTITLE HANDLING
    // ========================================================================

    /**
     * Load external subtitle cues (from file picker or API download).
     */
    const loadExternalCues = useCallback((cues: SubtitleCue[], name: string, isSDH: boolean) => {
        if (!cues || cues.length === 0) {return;}

        // Set as current display subtitle; one you pick with sound tags also shapes haptics.
        setSubtitleCues(cues);
        if (tagCount(cues) > 0) {setHapticCues(cues);}
        setSelectedSubtitleTrackIndex(EXTERNAL_SUBTITLE_INDEX);
        setCurrentExternalName(name);

        // Add to external subtitles list if not already there
        setExternalSubtitles(prev => {
            const exists = prev.some(s => s.name === name);
            if (exists) {return prev;}
            return [...prev, { name, cues, isSDH, source: 'file' }];
        });

        saveExternalSubtitle({ videoPath, name, isSDH, cues });

        if (__DEV__) {
            if (__DEV__) {console.log('[usePlayerTracks] Loaded external subtitle:', name, cues.length, 'cues', isSDH ? '(SDH)' : '');}
        }
    }, [videoPath]);

    // History records "external" but not the cues: bring back the saved file, or fall back to Off.
    useEffect(() => {
        if (initialSubtitleTrackIndex !== EXTERNAL_SUBTITLE_INDEX) {return;}
        let mounted = true;
        loadExternalSubtitle(videoPath).then(saved => {
            if (!mounted) {return;}
            if (!saved) {
                setSelectedSubtitleTrackIndex(null);
                return;
            }
            loadExternalCues(saved.cues, saved.name, saved.isSDH);
        });
        return () => { mounted = false; };
    }, [videoPath, initialSubtitleTrackIndex, loadExternalCues]);

    // ========================================================================
    // SELECTORS FOR COMPONENT PROPS
    // ========================================================================

    const audioTracksForSelector = useMemo(() =>
        audioTracks.map((track) => ({
            index: track.id,
            type: 'audio' as const,
            codec: 'audio',
            language: track.name,
            title: track.name,
            isDefault: false,
        })),
        [audioTracks]
    );

    const subtitleTracksForSelector = useMemo(() =>
        subtitleTracks.map((track) => ({
            index: track.index,
            type: 'subtitle' as const,
            codec: track.codec,
            language: track.language || 'und',
            title: track.title || `Subtitle ${track.index}`,
            isDefault: track.isDefault || false,
        })),
        [subtitleTracks]
    );

    // ========================================================================
    // RETURN
    // ========================================================================

    return useMemo(() => ({
        // Audio
        audioTracks,
        selectedAudioTrackId,
        selectAudioTrack,

        // Subtitles
        subtitleTracks,
        subtitleTracksReady,
        subtitleCuesLoading,
        selectedSubtitleTrackIndex,
        subtitleCues,
        currentSubtitleCue: useSubtitleCueStore.getState().currentCue,
        nativeTextTrackOrdinal,
        selectSubtitleTrack,

        // External
        externalSubtitles,
        currentExternalName,
        loadExternalCues,

        // Haptic
        hapticCues,

        // Selectors
        audioTracksForSelector,
        subtitleTracksForSelector,

        // For parent to set audio tracks from native player
        setAudioTracksFromNative,
        setSubtitleTracksFromPlayer,
        // For drift correction updates
        setSubtitleCues,
    }), [
        audioTracks, selectedAudioTrackId, selectAudioTrack,
        subtitleTracks, subtitleTracksReady, subtitleCuesLoading, selectedSubtitleTrackIndex, subtitleCues, selectSubtitleTrack,
        externalSubtitles, currentExternalName, loadExternalCues,
        hapticCues,
        audioTracksForSelector, subtitleTracksForSelector,
        setAudioTracksFromNative,
        setSubtitleTracksFromPlayer,
    ]);
}

export default usePlayerTracks;


