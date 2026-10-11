import { Platform } from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { pick } from '@react-native-documents/picker';
import { createMMKV } from 'react-native-mmkv';
import { AudioTrack, LyricLine } from '@/types';
import { useAppStore } from '@/store/appStore';
import { AudioMediaService } from './AudioMediaService';

const lyricsMMKV = createMMKV({ id: 'glide_lyrics_cache_v1' });

export interface LyricsTrackInfo {
    id: string;
    path?: string;
    uri?: string;
    title?: string;
    artist?: string;
    album?: string;
    duration?: number;
}

/**
 * Parses LRC format strings into an array of time-indexed lines.
 * Supports standard [mm:ss.xx], [mm:ss.xxx], and 1-digit fractions like [mm:ss.x].
 * Also supports multi-tag lines like [mm:ss.xx][mm:ss.yy].
 */
export function parseLrc(content: string): LyricLine[] {
    const lines = content.split(/\r?\n/);
    const result: LyricLine[] = [];
    const timeTagRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        timeTagRegex.lastIndex = 0;
        const matches: number[] = [];
        let match: RegExpExecArray | null;

        while ((match = timeTagRegex.exec(line)) !== null) {
            const min = parseInt(match[1], 10);
            const sec = parseInt(match[2], 10);
            const fraction = match[3] ? parseFloat(`0.${match[3]}`) : 0;
            const timeInSeconds = min * 60 + sec + fraction;
            matches.push(timeInSeconds);
        }

        if (matches.length > 0) {
            const text = line.replace(timeTagRegex, '').trim();
            for (const time of matches) {
                result.push({ time, text });
            }
        }
    }

    result.sort((a, b) => a.time - b.time);
    return result;
}

/**
 * Splits plain text lyrics without time tags into displayable lines.
 * Lines have time: -1 to mark them as unsynced.
 */
export function parsePlainLyrics(content: string): LyricLine[] {
    const lines = content.split(/\r?\n/);
    const result: LyricLine[] = [];
    for (const rawLine of lines) {
        const text = rawLine.trim();
        if (text) {
            result.push({ time: -1, text });
        }
    }
    return result;
}

/**
 * Returns true if lyrics contain valid timestamps (> 0).
 */
export function isLyricsSynced(lyrics: LyricLine[] | null): boolean {
    if (!lyrics || lyrics.length === 0) return false;
    return lyrics.some((l) => l.time > 0);
}

/** Shown for a stretch with no words. */
export const INSTRUMENTAL = '♪';
const INTRO_MIN_S = 5;
// ponytail: LRC only says when a line starts, not when it ends. A gap this long nearly always
// holds a break, and the ♪ comes in once the last line has likely been sung. Tune if it lies.
const GAP_MIN_S = 15;
const LINE_TAIL_S = 6;

/**
 * Synced lyrics with ♪ lines for instrumental stretches: blank LRC lines, an intro before
 * the first line, and long gaps between lines. Unsynced lyrics come back unchanged.
 */
export function withInstrumentalBreaks(lyrics: LyricLine[]): LyricLine[] {
    if (!isLyricsSynced(lyrics)) return lyrics;
    const out: LyricLine[] = [];
    const push = (line: LyricLine) => {
        // Two breaks in a row read as one.
        if (line.text === INSTRUMENTAL && out[out.length - 1]?.text === INSTRUMENTAL) return;
        out.push(line);
    };
    if (lyrics[0].time >= INTRO_MIN_S) push({ time: 0, text: INSTRUMENTAL });
    lyrics.forEach((line, i) => {
        push(line.text ? line : { time: line.time, text: INSTRUMENTAL });
        const next = lyrics[i + 1];
        if (line.text && next && next.time - line.time >= GAP_MIN_S) {
            push({ time: line.time + LINE_TAIL_S, text: INSTRUMENTAL });
        }
    });
    return out;
}

export class LyricsServiceClass {
    private cache = new Map<string, LyricLine[] | null>();

    async getLyricsForTrack(
        trackOrId: string | AudioTrack | LyricsTrackInfo,
        filePath?: string
    ): Promise<LyricLine[] | null> {
        if (!trackOrId && !filePath) return null;

        let trackId = '';
        let path = filePath;
        let uri: string | undefined;
        let title: string | undefined;
        let artist: string | undefined;
        let album: string | undefined;
        let duration: number | undefined;

        if (typeof trackOrId === 'string') {
            trackId = trackOrId;
        } else if (trackOrId) {
            trackId = trackOrId.id;
            path = trackOrId.path ?? filePath;
            uri = trackOrId.uri;
            title = trackOrId.title;
            artist = trackOrId.artist;
            album = trackOrId.album;
            duration = trackOrId.duration;
        }

        const cacheKey = trackId || path || uri || '';
        if (!cacheKey) return null;

        // 1. In-memory cache
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey) ?? null;
        }

        // 2. Persistent storage (MMKV cache)
        if (trackId) {
            try {
                const storedLrc = lyricsMMKV.getString(`lyrics_${trackId}`);
                if (storedLrc) {
                    const parsed = parseLrc(storedLrc);
                    const finalLines = parsed.length > 0 ? parsed : parsePlainLyrics(storedLrc);
                    if (finalLines.length > 0) {
                        this.cache.set(cacheKey, finalLines);
                        return finalLines;
                    }
                }
            } catch {
                // Ignore storage errors
            }
        }

        // 3. Companion .lrc file beside audio file
        if (path) {
            try {
                const lrcPath = path.replace(/\.[^/.]+$/, '.lrc');
                const exists = await RNFS.exists(lrcPath);
                if (exists) {
                    const rawContent = await RNFS.readFile(lrcPath, 'utf8');
                    const parsed = parseLrc(rawContent);
                    const finalResult = parsed.length > 0 ? parsed : parsePlainLyrics(rawContent);
                    if (finalResult.length > 0) {
                        if (trackId) {
                            try { lyricsMMKV.set(`lyrics_${trackId}`, rawContent); } catch { /* ignore */ }
                        }
                        this.cache.set(cacheKey, finalResult);
                        return finalResult;
                    }
                }
            } catch {
                // Ignore filesystem errors
            }
        }

        // 4. Embedded lyrics (ID3v2 USLT/SYLT, FLAC VORBIS_COMMENT, MP4 ©lyr)
        try {
            const embedded = await AudioMediaService.getEmbeddedLyrics(uri, path);
            if (embedded && embedded.trim().length > 0) {
                const parsed = parseLrc(embedded);
                const finalResult = parsed.length > 0 ? parsed : parsePlainLyrics(embedded);
                if (finalResult.length > 0) {
                    if (trackId) {
                        try { lyricsMMKV.set(`lyrics_${trackId}`, embedded); } catch { /* ignore */ }
                    }
                    this.cache.set(cacheKey, finalResult);
                    return finalResult;
                }
            }
        } catch {
            // Ignore native metadata errors
        }

        // 5. LRCLIB online provider
        const onlineLyricsEnabled = useAppStore.getState().settings.onlineLyricsEnabled;
        let lookupFailed = false;
        if (onlineLyricsEnabled && title && artist && artist !== '<unknown>' && !artist.startsWith('Unknown')) {
            try {
                const fetched = await this.fetchFromLrclib(title, artist, album, duration);
                if (fetched) {
                    const parsed = parseLrc(fetched);
                    const finalResult = parsed.length > 0 ? parsed : parsePlainLyrics(fetched);
                    if (finalResult.length > 0) {
                        if (trackId) {
                            try { lyricsMMKV.set(`lyrics_${trackId}`, fetched); } catch { /* ignore */ }
                        }
                        this.cache.set(cacheKey, finalResult);
                        return finalResult;
                    }
                }
            } catch {
                // LRCLIB could not be asked (offline, timeout, server error): not an answer.
                lookupFailed = true;
            }
        }

        // Remember "not found" only when it is an answer: online lookup was on (enabling it
        // later re-asks without a restart) and LRCLIB was actually reached (a network blip
        // must not hide lyrics for the rest of the session).
        if (onlineLyricsEnabled && !lookupFailed) {
            this.cache.set(cacheKey, null);
        }
        return null;
    }

    private async fetchFromLrclib(
        title: string,
        artist: string,
        album?: string,
        duration?: number
    ): Promise<string | null> {
        // Strip extraneous info like (feat. ...), [Remastered], etc. for cleaner matches
        const cleanTitle = title.replace(/\s*[\(\[][^()\[\]]*\b(feat|ft|remaster|version|mix)\b[^()\[\]]*[\)\]]/gi, '').trim();
        const cleanArtist = artist.replace(/\s*[\(\[][^()\[\]]*[\)\]]/g, '').trim();

        const headers = {
            'User-Agent': 'Glide-Music-Player (https://github.com/Pranav-pradeep0/glide)',
        };

        // 1. Try exact match
        const queryParams = new URLSearchParams({
            artist_name: cleanArtist,
            track_name: cleanTitle,
        });
        if (album && album !== '<unknown>') {
            queryParams.append('album_name', album);
        }
        if (duration && duration > 0) {
            queryParams.append('duration', Math.round(duration).toString());
        }

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 6000);
            const response = await fetch(`https://lrclib.net/api/get?${queryParams.toString()}`, {
                headers,
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (response.ok) {
                const data = await response.json();
                if (data.syncedLyrics && data.syncedLyrics.trim().length > 0) {
                    return data.syncedLyrics;
                }
                if (data.plainLyrics && data.plainLyrics.trim().length > 0) {
                    return data.plainLyrics;
                }
            }
        } catch {
            // Fall through to search
        }

        // 2. Fallback search. It is the last word, so it is not caught: failing to reach
        // LRCLIB here (offline, timeout, server error) throws, and the caller then knows it
        // has no answer rather than a "not found".
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const searchQuery = `${cleanArtist} ${cleanTitle}`.trim();
        const response = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(searchQuery)}`, {
            headers,
            signal: controller.signal,
        }).finally(() => clearTimeout(timeout));
        if (!response.ok) {
            throw new Error(`LRCLIB search failed: ${response.status}`);
        }

        const results = await response.json();
        if (!Array.isArray(results) || results.length === 0) {
            return null;
        }
        const normTargetArtist = cleanArtist.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, '');
        // Only accept search candidates that match artist roughly and duration within 4 seconds.
        // Reject candidates if either candidate or track has no duration.
        const validCandidates = results.filter((item) => {
            if (!item) return false;

            // Reject if either side lacks a valid positive duration
            if (!duration || duration <= 0 || typeof item.duration !== 'number' || item.duration <= 0) {
                return false;
            }
            if (Math.abs(item.duration - duration) > 4) {
                return false;
            }

            // Artist match using Unicode letter/number/mark normalisation
            const normItemArtist = String(item.artistName || '').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, '');
            if (!normTargetArtist || !normItemArtist) {
                return false;
            }
            if (!normItemArtist.includes(normTargetArtist) && !normTargetArtist.includes(normItemArtist)) {
                return false;
            }
            return true;
        });

        const best = validCandidates.find(item => item?.syncedLyrics?.trim()?.length > 0) || validCandidates[0];
        if (best?.syncedLyrics?.trim()) {
            return best.syncedLyrics;
        }
        if (best?.plainLyrics?.trim()) {
            return best.plainLyrics;
        }
        return null;
    }

    async pickAndSaveLyrics(trackId: string): Promise<LyricLine[] | null> {
        let tempCachePath: string | null = null;
        try {
            const result = await pick({
                mode: 'open',
                type: ['text/*', '*/*'],
            });

            if (!result || result.length === 0) return null;

            const file = result[0];
            let targetPath = file.uri;

            if (Platform.OS === 'android' && targetPath.startsWith('content://')) {
                tempCachePath = `${RNFS.CachesDirectoryPath}/picked_lyrics_${Date.now()}.lrc`;
                await RNFS.copyFile(targetPath, tempCachePath);
                targetPath = tempCachePath;
            }

            const rawContent = await RNFS.readFile(targetPath, 'utf8');
            const parsed = parseLrc(rawContent);
            const finalResult = parsed.length > 0 ? parsed : parsePlainLyrics(rawContent);

            if (finalResult.length > 0) {
                if (trackId) {
                    lyricsMMKV.set(`lyrics_${trackId}`, rawContent);
                }
                this.cache.set(trackId, finalResult);
                return finalResult;
            }
            return null;
        } catch (err) {
            console.warn('[LyricsService] Error picking lyrics:', err);
            return null;
        } finally {
            if (tempCachePath) {
                RNFS.unlink(tempCachePath).catch(() => {});
            }
        }
    }

    clearCache() {
        this.cache.clear();
    }
}

export const LyricsService = new LyricsServiceClass();
