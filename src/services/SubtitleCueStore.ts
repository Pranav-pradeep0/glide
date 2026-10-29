// src/services/SubtitleCueStore.ts

import * as RNFS from '@dr.pogodin/react-native-fs';
import { SubtitleExtractor, SubtitleTrack } from '../utils/SubtitleExtractor';
import { SubtitleParser } from '../utils/SubtitleParser';
import { SubtitleSelectionService } from './SubtitleSelectionService';
import { SubtitleCue } from '../types';

const LOG_PREFIX = '[SubtitleCueStore]';

/**
 * Singleton in-memory cache for parsed subtitle cues.
 * Keyed by: videoPath::trackIndex
 */
export class SubtitleCueStore {
    private static cache = new Map<string, SubtitleCue[]>();
    private static tracksCache = new Map<string, SubtitleTrack[]>();
    private static pendingPromises = new Map<string, Promise<SubtitleCue[]>>();
    private static pendingTracksPromises = new Map<string, Promise<SubtitleTrack[]>>();
    private static lru: string[] = [];
    private static tracksLru: string[] = [];
    private static readonly MAX_CACHE_SIZE = 5;
    private static readonly MAX_TRACKS_CACHE_SIZE = 20;

    private static getCacheKey(videoPath: string, trackIndex: number): string {
        return `${videoPath}::${trackIndex}`;
    }

    private static recordAccess(key: string) {
        this.lru = this.lru.filter(k => k !== key);
        this.lru.push(key);

        // Evict oldest if limit reached
        if (this.lru.length > this.MAX_CACHE_SIZE) {
            const oldest = this.lru.shift();
            if (oldest) {
                this.cache.delete(oldest);
                if (__DEV__) {console.log(`${LOG_PREFIX} Evicted oldest cue cache entry:`, oldest);}
            }
        }
    }

    private static recordTracksAccess(videoPath: string) {
        this.tracksLru = this.tracksLru.filter(p => p !== videoPath);
        this.tracksLru.push(videoPath);

        if (this.tracksLru.length > this.MAX_TRACKS_CACHE_SIZE) {
            const oldest = this.tracksLru.shift();
            if (oldest) {
                this.tracksCache.delete(oldest);
                if (__DEV__) {console.log(`${LOG_PREFIX} Evicted oldest tracks cache entry:`, oldest);}
            }
        }
    }

    /**
     * Get subtitle tracks for a video (cached/locked).
     */
    static async getTracks(videoPath: string): Promise<SubtitleTrack[]> {
        // 1. Check cache
        const cached = this.tracksCache.get(videoPath);
        if (cached) {
            if (__DEV__) {console.log(`${LOG_PREFIX} Tracks cache HIT for:`, videoPath);}
            this.recordTracksAccess(videoPath);
            return cached;
        }

        // 2. Check pending
        const pending = this.pendingTracksPromises.get(videoPath);
        if (pending) {
            if (__DEV__) {console.log(`${LOG_PREFIX} Waiting for parallel tracks extraction:`, videoPath);}
            return pending;
        }

        // 3. Extract with locking
        const tracksPromise = (async () => {
            if (__DEV__) {console.log(`${LOG_PREFIX} Tracks cache MISS for:`, videoPath);}
            try {
                const tracks = await SubtitleExtractor.getSubtitleTracks(videoPath);
                if (tracks && tracks.length > 0) {
                    this.tracksCache.set(videoPath, tracks);
                    this.recordTracksAccess(videoPath);
                }
                return tracks || [];
            } catch (error) {
                console.error(`${LOG_PREFIX} Failed to get tracks for ${videoPath}:`, error);
                return [];
            } finally {
                this.pendingTracksPromises.delete(videoPath);
            }
        })();

        this.pendingTracksPromises.set(videoPath, tracksPromise);
        return tracksPromise;
    }

    /**
     * Get cached cues without extraction.
     */
    static getCachedCues(videoPath: string, trackIndex: number): SubtitleCue[] | null {
        const key = this.getCacheKey(videoPath, trackIndex);
        const cached = this.cache.get(key);
        if (cached) {
            if (__DEV__) {console.log(`${LOG_PREFIX} Cache HIT for:`, key);}
            this.recordAccess(key);
            return cached;
        }
        return null;
    }

    /**
     * Extract, parse, and cache cues for a track.
     */
    static async getCues(videoPath: string, trackIndex: number): Promise<SubtitleCue[]> {
        const key = this.getCacheKey(videoPath, trackIndex);

        // 1. Check in-memory cache
        const cached = this.getCachedCues(videoPath, trackIndex);
        if (cached) {return cached;}

        // 2. Check for pending extraction of the same track
        const pending = this.pendingPromises.get(key);
        if (pending) {
            if (__DEV__) {console.log(`${LOG_PREFIX} Waiting for parallel extraction:`, key);}
            return pending;
        }

        // 3. Perform extraction with locking
        const extractionPromise = (async () => {
            if (__DEV__) {console.log(`${LOG_PREFIX} Cache MISS for ${key}, extracting...`);}
            try {
                const path = await SubtitleExtractor.extractSubtitle(videoPath, trackIndex, 'srt');
                if (!path) {return [];}

                const content = await SubtitleExtractor.readSubtitleFile(path);
                if (!content) {return [];}

                const cues = SubtitleParser.parse(content, 'srt');

                // OPTIMIZATION: Delete the temporary file immediately after parsing.
                // We have the cues in memory now, so the file is no longer needed.
                try {
                    await RNFS.unlink(path);
                    if (__DEV__) {console.log(`${LOG_PREFIX} Deleted temp file after parsing:`, path);}
                } catch (e) {
                    // Non-fatal error
                    console.warn(`${LOG_PREFIX} Failed to delete temp file:`, path, e);
                }

                if (cues && cues.length > 0) {
                    this.cache.set(key, cues);
                    this.recordAccess(key);
                    if (__DEV__) {console.log(`${LOG_PREFIX} Cached ${cues.length} cues for:`, key);}
                    return cues;
                }
                return [];
            } catch (error) {
                console.error(`${LOG_PREFIX} Failed to get cues for ${key}:`, error);
                return [];
            } finally {
                // Remove from pending promises once done
                this.pendingPromises.delete(key);
            }
        })();

        this.pendingPromises.set(key, extractionPromise);
        return extractionPromise;
    }

    /**
     * Find the best non-forced, non-bitmap track for a video and return its cues.
     * Useful for recap generation when no track is active.
     */
    static async getBestTrackCues(
        videoPath: string,
        tracks: SubtitleTrack[],
        preferredLang: string = 'en'
    ): Promise<{ trackIndex: number, cues: SubtitleCue[] } | null> {

        // 1. Filter out bitmap tracks
        const textTracks = tracks.filter(t => !t.isBitmap && SubtitleExtractor.isTextSubtitle(t.codec));
        if (textTracks.length === 0) {
            if (__DEV__) {console.log(`${LOG_PREFIX} No text-based tracks found.`);}
            return null;
        }

        // 2. Score with SubtitleSelectionService
        const scored = SubtitleSelectionService.scoreEmbeddedTracks(textTracks, preferredLang);

        // Pick the best normal track if possible, or fallback to the absolute best scored (even if forced)
        // because for recap, some dialogue is better than no dialogue.
        const best = scored[0]?.track;

        if (!best) {
            if (__DEV__) {console.warn(`${LOG_PREFIX} No optimal track found among ${textTracks.length} text tracks.`);}
            return null;
        }

        // 3. Get cues (uses cache/locking if available)
        const cues = await this.getCues(videoPath, best.index);

        // 4. Verification fallback: If the "best" track was empty/failed, try the next best one
        if (cues.length === 0 && scored.length > 1) {
            if (__DEV__) {console.log(`${LOG_PREFIX} Best track ${best.index} was empty, trying runner-up...`);}
            const runnerUp = scored[1].track;
            const runnerUpCues = await this.getCues(videoPath, runnerUp.index);
            if (runnerUpCues.length > 0) {
                return { trackIndex: runnerUp.index, cues: runnerUpCues };
            }
        }

        if (cues.length > 0) {
            return { trackIndex: best.index, cues };
        }

        return null;
    }
}
