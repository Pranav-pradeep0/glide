// src/services/ContentDetector.ts
import { OMDBService, OMDBResult } from './OMDBService';
import { FilenameParser } from '../utils/FilenameParser';

const LOG_PREFIX = '[ContentDetector]';

export interface ContentClassification {
    isPlayableContent: boolean;  // Movie OR Series (not home video)
    contentType: 'movie' | 'series' | 'home_video' | 'unknown';
    confidence: number;  // 0-1
    parsedTitle?: string;
    parsedYear?: number;
    omdbData?: OMDBResult;
    imdbId?: string;
}

// Technical patterns - very high confidence of professional content
const TECHNICAL_PATTERNS = [
    /\b(1080p|720p|480p|2160p|4k|uhd|fhd|full ?hd)\b/i,
    /[([](19|20)\d{2}\b/,  // "Title (1994)": the Plex/Jellyfin film naming convention
    /\b(bluray|bdrip|brrip|webrip|web-?dl|hdtv|dvdrip|hdrip|hdcam|hd-?rip)\b/i,
    /\b(x264|x265|hevc|avc|xvid|divx|h\.?264|h\.?265)\b/i,
    /\b(aac|ac3|dts|truehd|atmos|dd5\.?1|5\.1|7\.1)\b/i,
    /\b(hdr|hdr10|dolby.?vision|dv)\b/i,
    /-[a-zA-Z0-9]{2,10}$/, // Release group pattern
];

// Contextual patterns - good indicators but can appear in home videos (lower confidence)
const CONTEXTUAL_PATTERNS = [
    /\b(19|20)\d{2}\b/, // Standalone year
    /\b(HQ|UNRATED|DC|EXTENDED|REMASTERED|RECAP)\b/i,
];

// TV series patterns - detect episode notation
const SERIES_PATTERNS = [
    /S\d{1,2}E\d{1,2}/i,           // S01E01, S1E1
    /Season\s*\d+/i,               // Season 1
    /\d{1,2}x\d{1,2}/i,            // 1x01
    /Episode\s*\d+/i,              // Episode 1
    /\bE\d{2,}\b/i,                // E01 (standalone)
    /\bEp\.?\s*\d+/i,              // Ep 1, Ep.1
    /\[\d{1,2}\/\d{1,2}\]/,        // [01/12] episode notation
];

// Home video patterns - definitely NOT movies/series
const HOME_VIDEO_PATTERNS = [
    /^VID[-_]\d{8}/i,              // VID_20241205
    /^IMG[-_]\d{8}/i,              // IMG_20241205
    /^MVI[-_]?\d{4}/i,             // MVI_1234
    /^DSC[-_]?\d{4}/i,             // DSC_1234
    /^MOV[-_]?\d{4}/i,             // MOV_1234
    /^DCIM/i,                      // Camera folder videos
    /^Screen[-_]?Recording/i,      // Screen recordings
    /^WhatsApp[-_]Video/i,         // WhatsApp videos
    /^Telegram[-_]/i,              // Telegram videos
    /^InShot/i,                    // InShot edited videos
    /^Snapchat/i,                  // Snapchat videos
    /^Instagram/i,                 // Instagram videos
    /^TikTok/i,                    // TikTok videos
    /^Record[-_]\d{4}/i,           // Record_0001
    /^\d{8}[-_]\d{6}/,             // 20241205_143022
    /^PXL_\d{8}/i,                 // Pixel phone format
    /^GOPR\d{4}/i,                 // GoPro format
];

// Callers pass full paths; the folders would leak into the parsed title and
// stop the ^-anchored home-video patterns from ever matching.
const baseName = (path: string) => path.split('/').pop() ?? path;

export class ContentDetector {
    /**
     * Main detection method - analyzes filename and optionally verifies with OMDB
     */
    static async classify(
        filename: string,
        verifyWithOMDB: boolean = true
    ): Promise<ContentClassification> {
        const startTime = Date.now();
        filename = baseName(filename);
        if (__DEV__) { console.log(`${LOG_PREFIX} Classifying:`, filename); }

        // Step 1: Quick reject home videos (no API call needed)
        if (this.isHomeVideo(filename)) {
            if (__DEV__) { console.log(`${LOG_PREFIX} Detected as home video`); }
            return {
                isPlayableContent: false,
                contentType: 'home_video',
                confidence: 0.95,
            };
        }

        // Step 2: Check for series patterns
        const isSeries = this.hasSeriesPattern(filename);
        if (isSeries) {
            if (__DEV__) { console.log(`${LOG_PREFIX} Detected series pattern`); }
        }

        // Step 3: Check for release patterns (movies OR series)
        const techScore = this.calculatePatternScore(filename, TECHNICAL_PATTERNS);
        const contextScore = this.calculatePatternScore(filename, CONTEXTUAL_PATTERNS);
        const totalScore = techScore + contextScore;

        if (__DEV__) { console.log(`${LOG_PREFIX} Scores:`, { tech: techScore, context: contextScore }); }

        // Step 4: Extract title and year from filename
        const parsed = FilenameParser.parse(filename);
        if (__DEV__) { console.log(`${LOG_PREFIX} Parsed:`, parsed); }

        // Step 5: If high confidence from patterns alone and no OMDB needed
        // We require at least one technical marker OR very high contextual count
        const highConfidence = techScore >= 1 || contextScore >= 3;
        if (highConfidence && !verifyWithOMDB) {
            return {
                isPlayableContent: true,
                contentType: isSeries ? 'series' : 'movie',
                confidence: Math.min(0.85, 0.5 + totalScore * 0.1),
                parsedTitle: parsed.title,
                parsedYear: parsed.year,
            };
        }

        // Step 6: Verify with OMDB for high confidence
        // Allow short titles (like "Us", "Up") ONLY if we have a year to avoid false positives
        if (verifyWithOMDB && parsed.title && (parsed.title.length > 1 || (parsed.title.length > 0 && parsed.year))) {
            try {
                // OMDB matches a series only by its first year, and a year in an episode's
                // name is usually the season's: "The Boys (2026)" with y=2026 finds a different show.
                const type = isSeries ? 'series' : undefined;
                const year = isSeries ? undefined : parsed.year;
                let omdbResult = await OMDBService.search(parsed.title, year, type);

                // Fallback: If exact search fails, try fuzzy search (s parameter)
                if (!omdbResult) {
                    if (__DEV__) { console.log(`${LOG_PREFIX} Exact match failed, trying fuzzy search...`); }
                    const fuzzyResults = await OMDBService.fuzzySearch(parsed.title, type);

                    // Look for a result with matching year and high title similarity
                    if (fuzzyResults.length > 0) {
                        const bestFuzzy = fuzzyResults.find(r =>
                            (!year || r.Year.includes(year.toString())) &&
                            (r.Type === 'movie' || r.Type === 'series')
                        );

                        if (bestFuzzy) {
                            if (__DEV__) { console.log(`${LOG_PREFIX} Found likely fuzzy match:`, bestFuzzy.Title); }
                            // Get full details for the fuzzy match
                            omdbResult = await OMDBService.getByIMDBId(bestFuzzy.imdbID);
                        }
                    }
                }

                if (omdbResult) {
                    const duration = Date.now() - startTime;
                    if (__DEV__) {
                        console.log(`${LOG_PREFIX} OMDB verified in ${duration}ms:`, {
                            title: omdbResult.Title,
                            type: omdbResult.Type,
                        });
                    }

                    return {
                        isPlayableContent: true,
                        contentType: omdbResult.Type === 'series' ? 'series' : 'movie',
                        confidence: 0.95,
                        parsedTitle: omdbResult.Title,
                        parsedYear: parseInt(omdbResult.Year, 10),
                        omdbData: omdbResult,
                        imdbId: omdbResult.imdbID,
                    };
                }
            } catch (error) {
                console.warn(`${LOG_PREFIX} OMDB verification failed:`, error);
            }
        }

        // Step 7: Fallback based on release patterns only
        if (techScore >= 1 || contextScore >= 3) {
            if (__DEV__) { console.log(`${LOG_PREFIX} Fallback: using pattern score`); }
            return {
                isPlayableContent: true,
                contentType: isSeries ? 'series' : 'movie',
                confidence: 0.6,
                parsedTitle: parsed.title,
                parsedYear: parsed.year,
            };
        }

        // Step 8: Unknown - treat as potentially playable with low confidence
        if (__DEV__) { console.log(`${LOG_PREFIX} Unknown content type`); }
        return {
            isPlayableContent: totalScore >= 1,
            contentType: 'unknown',
            confidence: 0.3,
            parsedTitle: parsed.title,
        };
    }

    /**
     * Quick sync check without OMDB - for initial filtering
     */
    static classifySync(filename: string): {
        likelyContent: boolean;
        contentType: 'movie' | 'series' | 'home_video' | 'unknown';
    } {
        filename = baseName(filename);
        if (this.isHomeVideo(filename)) {
            return { likelyContent: false, contentType: 'home_video' };
        }

        const isSeries = this.hasSeriesPattern(filename);
        const techScore = this.calculatePatternScore(filename, TECHNICAL_PATTERNS);
        const contextScore = this.calculatePatternScore(filename, CONTEXTUAL_PATTERNS);

        // Threshold logic:
        // 1. Episodes are always series
        // 2. Technical markers (1080p, Bluray, etc.) are high confidence
        // 3. Contextual alone (Year + HQ) triggers direct play to avoid false positives
        //    UNLESS we have at least 3 contextual markers.
        const likelyProfessional = isSeries || techScore >= 1 || contextScore >= 3;

        if (likelyProfessional) {
            return {
                likelyContent: true,
                contentType: isSeries ? 'series' : 'movie',
            };
        }

        return { likelyContent: false, contentType: 'unknown' };
    }

    private static isHomeVideo(filename: string): boolean {
        return HOME_VIDEO_PATTERNS.some(pattern => pattern.test(filename));
    }

    private static hasSeriesPattern(filename: string): boolean {
        // Replace separators with spaces to ensure word boundaries and space-based patterns work
        const normalized = filename.replace(/[._]/g, ' ');
        return SERIES_PATTERNS.some(pattern => pattern.test(normalized));
    }

    private static calculatePatternScore(filename: string, patterns: RegExp[]): number {
        // Replace separators with spaces to ensure word boundaries work
        const normalized = filename.replace(/[._]/g, ' ');
        return patterns.filter(pattern => pattern.test(normalized)).length;
    }
}


