// src/utils/subdlApi.ts

import { SubtitleCue, SubtitleResult } from '../types';
import { SUBDL_API_URL, SUBDL_API_KEY, SUBDL_DOWNLOAD_URL } from './constants';
import { NativeModules } from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { hasNativeApi } from '@/native/GlideNative';
import { FilenameParser } from './FilenameParser';
import { SubtitleParser } from './SubtitleParser';
import { createCoalescedRequest, fetchWithTimeout, InFlightRequest, isAbortError, NetworkTimeoutError } from './network';

const LOG_PREFIX = '[SubDL]';
const SUBDL_SEARCH_TIMEOUT_MS = 12000;
const SUBDL_DOWNLOAD_TIMEOUT_MS = 20000;
/** A subtitle zip is tens of KB, a full-season pack a few MB; the subtitle inside is capped natively. */
const MAX_SUBTITLE_ZIP_BYTES = 10 * 1024 * 1024;
const inFlightSubtitleSearches = new Map<string, InFlightRequest<{ subtitles: SubtitleResult[] }>>();
const inFlightSubtitleDownloads = new Map<string, InFlightRequest<SubtitleCue[] | null>>();

function createDownloadAbortError(): Error {
    const error = new Error('Download aborted');
    error.name = 'AbortError';
    return error;
}

// Constants for SDH detection
const SDH_KEYWORDS = [
    'sdh',
    'cc',
    'closed.caption',
    'closed-caption',
    'closedcaption',
    'hearing.impaired',
    'hearing-impaired',
    'hearingimpaired',
    'hi',
    'hoh',
    'deaf',
    'hard.of.hearing',
    'hard-of-hearing',
];

/**
 * Calculate SDH score based on multiple factors
 */
function calculateSDHScore(sub: any): number {
    let score = 0;
    const releaseName = (sub.release_name || '').toLowerCase();
    const comment = (sub.comment || '').toLowerCase();

    // Check release name for SDH keywords (highest weight)
    SDH_KEYWORDS.forEach(keyword => {
        if (releaseName.includes(keyword)) {
            score += 10;
        }
    });

    // Check comment for SDH indicators
    SDH_KEYWORDS.forEach(keyword => {
        if (comment.includes(keyword)) {
            score += 5;
        }
    });

    // SubDL API's hi field (hearing impaired flag)
    if (sub.hi === 1 || sub.hi === true) {
        score += 15;
    }

    // Check for common SDH phrases in comments
    const sdhPhrases = [
        'sound effects',
        'sound descriptions',
        'music descriptions',
        'speaker identification',
        'includes sounds',
        'for deaf',
        'for hard of hearing',
    ];

    sdhPhrases.forEach(phrase => {
        if (comment.includes(phrase)) {
            score += 8;
        }
    });

    return score;
}



/**
 * Search for subtitles using simplified approach
 * Uses only: film_name, type, year, languages
 * Does NOT use season/episode numbers as they cause issues with SubDL
 */
export async function searchAllSubtitles(
    videoName: string,
    language: string = 'en',
    imdbId?: string,
    prioritizeSDH: boolean = true,
    signal?: AbortSignal,
    manualSeason?: number,
    manualEpisode?: number,
    manualYear?: number // Added
): Promise<{
    subtitles: SubtitleResult[];
}> {
    const requestKey = JSON.stringify({
        videoName,
        language,
        imdbId: imdbId || '',
        prioritizeSDH,
        manualSeason,
        manualEpisode,
        manualYear,
    });

    if (__DEV__) {console.log(`${LOG_PREFIX} === Search Started ===`);}
    if (__DEV__) {console.log(`${LOG_PREFIX} videoName: "${videoName}", language: "${language}", imdbId: ${imdbId || 'none'}, prioritizeSDH: ${prioritizeSDH}, manualSeason: ${manualSeason || 'none'}, manualEpisode: ${manualEpisode || 'none'}, manualYear: ${manualYear || 'none'}`);}

    const requestFactory = createCoalescedRequest(
        inFlightSubtitleSearches,
        requestKey,
        (sharedSignal) => executeSubtitleSearch(
            videoName,
            language,
            imdbId,
            prioritizeSDH,
            sharedSignal,
            manualSeason,
            manualEpisode,
            manualYear
        ),
        signal
    );

    // A failure rejects rather than reading as "no results", so the caller can say so.
    try {
        return await requestFactory;
    } catch (error) {
        if (error instanceof NetworkTimeoutError) {
            console.warn(`${LOG_PREFIX} Search timed out after ${error.timeoutMs}ms`);
        } else if (!isAbortError(error)) {
            console.error(`${LOG_PREFIX} Search error:`, error);
        }
        throw error;
    }
}

/**
 * Search for SDH subtitles specifically
 * Uses same simplified approach
 */
export async function searchSDHSubtitles(
    videoName: string,
    language: string = 'en',
    imdbId?: string,
    signal?: AbortSignal
): Promise<{
    subtitles: SubtitleResult[];
}> {
    // Use the same search as searchAllSubtitles
    // SDH filtering is done via scoring after results are returned
    return searchAllSubtitles(videoName, language, imdbId, true, signal);
}

/**
 * Process subtitle results into our format
 */
function processSubtitleResults(
    subtitles: any[],
    defaultName: string,
    language: string,
    prioritizeSDH: boolean = true
): { subtitles: SubtitleResult[] } {
    const allSubtitles: SubtitleResult[] = subtitles.map((sub: any, index: number) => ({
        id: sub.sd_id || sub.id || `sub_${index}`,
        name: sub.name || defaultName,
        language: sub.lang || language,
        release: sub.release_name || 'Unknown',
        downloadUrl: sub.url || sub.download_url || '',
        author: sub.author || 'Unknown',
        rating: sub.rating || 0,
        hearingImpaired: sub.hi === 1 || sub.hi === true,
        sdhScore: calculateSDHScore(sub),
        comment: sub.comment || '',
    }));

    // Sort subtitles based on priority preference
    if (__DEV__) {console.log(`${LOG_PREFIX} Sorting ${allSubtitles.length} subtitles with prioritizeSDH=${prioritizeSDH}`);}

    // Count SDH vs non-SDH before sorting
    const sdhCount = allSubtitles.filter(s => (s.sdhScore || 0) > 5 || s.hearingImpaired).length;
    const nonSdhCount = allSubtitles.length - sdhCount;
    if (__DEV__) {console.log(`${LOG_PREFIX} SDH subtitles: ${sdhCount}, Non-SDH subtitles: ${nonSdhCount}`);}

    allSubtitles.sort((a: any, b: any) => {
        if (prioritizeSDH) {
            // Prioritize SDH subtitles (score > 5), then by rating
            if (b.sdhScore !== a.sdhScore && (b.sdhScore > 5 || a.sdhScore > 5)) {
                return b.sdhScore - a.sdhScore;
            }
        }
        return (b.rating || 0) - (a.rating || 0);
    });

    // Log first 3 results after sorting
    if (__DEV__) {console.log(`${LOG_PREFIX} Top 3 results after sorting (prioritizeSDH=${prioritizeSDH}):`);}
    allSubtitles.slice(0, 3).forEach((sub, i) => {
        const isSDH = (sub.sdhScore || 0) > 5 || sub.hearingImpaired;
        if (__DEV__) {console.log(`${LOG_PREFIX}   ${i + 1}. "${sub.release?.substring(0, 40)}..." - SDH: ${isSDH}, sdhScore: ${sub.sdhScore || 0}, rating: ${sub.rating || 0}`);}
    });

    return { subtitles: allSubtitles };
}

/**
 * Download a subtitle from SubDL and parse it (SRT, VTT or ASS/SSA, detected from the content).
 * Null when the download fails or the file has no readable cues.
 */
export async function downloadSubtitle(
    downloadUrl: string,
    signal?: AbortSignal
): Promise<SubtitleCue[] | null> {
    const fullUrl = subtitleDownloadUrl(downloadUrl);
    if (!fullUrl) {
        console.error(`${LOG_PREFIX} Refused a non-https download URL`);
        return null;
    }
    return createCoalescedRequest(
        inFlightSubtitleDownloads,
        fullUrl,
        (sharedSignal) => executeSubtitleDownload(fullUrl, sharedSignal),
        signal
    );
}

/** SubDL gives a path on its download host, or a full URL; only https is fetched. */
export function subtitleDownloadUrl(downloadUrl: string): string | null {
    const fullUrl = /^[a-z][a-z0-9+.-]*:/i.test(downloadUrl) ? downloadUrl : `${SUBDL_DOWNLOAD_URL}${downloadUrl}`;
    return fullUrl.toLowerCase().startsWith('https://') ? fullUrl : null;
}

async function executeSubtitleSearch(
    videoName: string,
    language: string,
    imdbId: string | undefined,
    prioritizeSDH: boolean,
    signal?: AbortSignal,
    manualSeason?: number,
    manualEpisode?: number,
    manualYear?: number
): Promise<{ subtitles: SubtitleResult[] }> {
    const parsed = FilenameParser.parse(videoName);
    if (__DEV__) {console.log(`${LOG_PREFIX} Parsed: "${parsed.title}", year=${parsed.year || 'unknown'}, isTVShow=${parsed.isTVShow}`);}

    if (!parsed.title || parsed.title.trim().length === 0) {
        console.warn(`${LOG_PREFIX} Warning: Parsed title is empty. Fallback to original.`);
    }

    const effectiveSeason = manualSeason !== undefined ? manualSeason : parsed.season;
    const effectiveEpisode = manualEpisode !== undefined ? manualEpisode : parsed.episode;
    const effectiveYear = manualYear !== undefined ? manualYear : parsed.year;
    const params = buildSearchParams({
        videoName,
        language,
        imdbId,
        prioritizeSDH,
        filmName: parsed.title || videoName,
        isTVShow: parsed.isTVShow || manualSeason !== undefined || manualEpisode !== undefined,
        year: effectiveYear,
        season: effectiveSeason,
        episode: effectiveEpisode,
        fullSeason: parsed.fullSeason,
        includeComments: true,
    });

    if (__DEV__) {console.log(`${LOG_PREFIX} Search params: ${params.toString()}`);}

    const data = await fetchSubtitlesJson(params, signal);
    if (!data.subtitles || data.subtitles.length === 0) {
        if (__DEV__) {console.log(`${LOG_PREFIX} No subtitles found`);}

        if (parsed.year && !imdbId) {
            if (__DEV__) {console.log(`${LOG_PREFIX} Retrying without year...`);}
            const fallbackParams = buildSearchParams({
                videoName,
                language,
                prioritizeSDH,
                filmName: parsed.title || videoName,
                isTVShow: parsed.isTVShow,
                season: parsed.season,
                episode: parsed.episode,
                fullSeason: parsed.fullSeason,
            });
            const fallbackData = await fetchSubtitlesJson(fallbackParams, signal, true);
            if (fallbackData.subtitles?.length) {
                if (__DEV__) {console.log(`${LOG_PREFIX} Fallback found ${fallbackData.subtitles.length} subtitles`);}
                return processSubtitleResults(fallbackData.subtitles, parsed.title, language, prioritizeSDH);
            }
        }

        return { subtitles: [] };
    }

    if (__DEV__) {console.log(`${LOG_PREFIX} Found ${data.subtitles.length} subtitles`);}
    if (__DEV__) {console.log(`${LOG_PREFIX} Passing prioritizeSDH=${prioritizeSDH} to processSubtitleResults`);}
    return processSubtitleResults(data.subtitles, parsed.title, language, prioritizeSDH);
}

async function executeSubtitleDownload(
    fullUrl: string,
    signal?: AbortSignal
): Promise<SubtitleCue[] | null> {
    const timestamp = Date.now();
    const zipPath = `${RNFS.CachesDirectoryPath}/subtitle_${timestamp}.zip`;
    let downloadJobId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let abortHandler: (() => void) | null = null;
    let didTimeout = false;
    let tooLarge = false;

    try {
        if (!hasNativeApi(7)) {
            throw new Error('Subtitle download needs the latest Glide update');
        }
        if (__DEV__) {console.log(`${LOG_PREFIX} Downloading from:`, fullUrl);}

        const download = RNFS.downloadFile({
            fromUrl: fullUrl,
            toFile: zipPath,
            headers: {
                'User-Agent': 'Glide/1.0',
            },
            // Reported per 8 KB read; the declared length can be missing or lie, so both count.
            progress: ({ contentLength, bytesWritten }) => {
                if (!tooLarge && Math.max(contentLength, bytesWritten) > MAX_SUBTITLE_ZIP_BYTES) {
                    tooLarge = true;
                    RNFS.stopDownload(download.jobId);
                }
            },
        });
        downloadJobId = download.jobId;

        if (signal?.aborted) {
            throw createDownloadAbortError();
        }

        abortHandler = () => {
            if (downloadJobId !== null) {
                RNFS.stopDownload(downloadJobId);
            }
        };
        if (signal) {
            signal.addEventListener('abort', abortHandler, { once: true });
        }

        timeoutId = setTimeout(() => {
            didTimeout = true;
            if (downloadJobId !== null) {
                RNFS.stopDownload(downloadJobId);
            }
        }, SUBDL_DOWNLOAD_TIMEOUT_MS);

        const downloadResult = await download.promise;

        if (downloadResult.statusCode !== 200) {
            throw new Error(`Download failed with status: ${downloadResult.statusCode}`);
        }

        if (signal?.aborted) {
            throw createDownloadAbortError();
        }

        if (__DEV__) {console.log(`${LOG_PREFIX} Downloaded ZIP (${downloadResult.bytesWritten} bytes)`);}

        // Picked and read natively, capped, without extracting anything (SubtitleZip.kt).
        const subtitleContent: string | null = await NativeModules.SubtitleSyncModule.readSubtitleFromZip(zipPath);
        if (!subtitleContent) {
            console.error(`${LOG_PREFIX} No subtitle file found in ZIP`);
            return null;
        }

        const cues = SubtitleParser.parse(subtitleContent);
        if (cues.length === 0) {
            console.error(`${LOG_PREFIX} No readable cues in the subtitle file`);
            return null;
        }

        if (__DEV__) {console.log(`${LOG_PREFIX} Parsed ${cues.length} cues`);}
        return cues;

    } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
            if (__DEV__) {console.log(`${LOG_PREFIX} Download aborted`);}
            throw error;
        }
        if (didTimeout) {
            throw new NetworkTimeoutError(SUBDL_DOWNLOAD_TIMEOUT_MS);
        }
        if (tooLarge) {
            console.error(`${LOG_PREFIX} Download is over ${MAX_SUBTITLE_ZIP_BYTES / 1024 / 1024} MB, stopped`);
            return null;
        }
        console.error(`${LOG_PREFIX} Download error:`, error);
        return null;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        if (signal && abortHandler) {
            signal.removeEventListener('abort', abortHandler);
        }
        // Cleanup temporary files
        try {
            if (await RNFS.exists(zipPath)) {
                await RNFS.unlink(zipPath);
            }
        } catch (cleanupError) {
            console.warn(`${LOG_PREFIX} Cleanup error:`, cleanupError);
        }
    }
}

/**
 * Search by IMDB ID directly
 */
export async function searchByIMDBId(
    imdbId: string,
    language: string = 'en'
): Promise<SubtitleResult[]> {
    const result = await searchAllSubtitles('', language, imdbId);
    return result.subtitles;
}

function buildSearchParams({
    videoName,
    language,
    imdbId,
    prioritizeSDH,
    filmName,
    isTVShow,
    year,
    season,
    episode,
    fullSeason,
    includeComments = false,
}: {
    videoName: string;
    language: string;
    imdbId?: string;
    prioritizeSDH: boolean;
    filmName: string;
    isTVShow: boolean;
    year?: number;
    season?: number;
    episode?: number;
    fullSeason?: boolean;
    includeComments?: boolean;
}): URLSearchParams {
    const params = new URLSearchParams({
        api_key: SUBDL_API_KEY,
        languages: language,
        subs_per_page: '30',
        releases: '1',
        film_name: filmName,
        type: isTVShow ? 'tv' : 'movie',
    });

    if (includeComments) {
        params.append('comment', '1');
    }
    if (year) {
        params.append('year', year.toString());
    }
    if (prioritizeSDH) {
        params.append('hi', '1');
        if (__DEV__) {console.log(`${LOG_PREFIX} Including hi=1 param (SDH prioritized)`);}
    } else if (__DEV__) {
        console.log(`${LOG_PREFIX} NOT including hi param (general search)`);
    }
    if (videoName) {
        params.append('file_name', videoName);
    }
    if (imdbId) {
        params.append('imdb_id', imdbId);
        if (__DEV__) {console.log(`${LOG_PREFIX} Also using IMDB ID: ${imdbId}`);}
    }
    if (isTVShow) {
        if (season !== undefined) {
            params.append('season_number', season.toString());
        }
        if (episode !== undefined) {
            params.append('episode_number', episode.toString());
        }
        if (fullSeason) {
            params.append('full_season', '1');
        }
    }

    return params;
}

async function fetchSubtitlesJson(
    params: URLSearchParams,
    signal?: AbortSignal,
    allowEmptyResponse: boolean = false
): Promise<{ subtitles?: any[] }> {
    const response = await fetchWithTimeout(`${SUBDL_API_URL}?${params}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal,
    }, SUBDL_SEARCH_TIMEOUT_MS);

    if (!response.ok) {
        if (allowEmptyResponse) {
            return {};
        }
        throw new Error(`SubDL API error: ${response.status}`);
    }

    return await response.json() as { subtitles?: any[] };
}


