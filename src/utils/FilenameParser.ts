import { filenameParse } from './video-filename-parser/filenameParse';

export interface ParsedFilename {
    title: string;
    year?: number;
    isTVShow: boolean;
    season?: number;
    episode?: number;
    fullSeason?: boolean;
    quality?: string;
    group?: string;
    // Original metadata for debugging/logging
    rawYear?: string;
}

export class FilenameParser {
    // Regex patterns to auto-detect TV shows
    private static readonly TV_PATTERNS = [
        /[Ss]\d{1,2}[Ee]\d{1,2}/,        // S01E01
        /[Ss]\d{1,2}/,                    // S01
        /\d{1,2}x\d{1,2}/,                // 1x01
        /[Ss]eason\s*\d{1,2}/i,           // Season 1
        /[Ee]pisode\s*\d{1,2}/i,          // Episode 1
        /Complete\s*Series/i,             // Complete Series
    ];

    /**
     * Main parse function using Hybrid Approach
     * 1. Pre-clean using our custom regexes
     * 2. Auto-detect TV Show status
     * 3. Parse using the robust library
     * 4. Post-clean and Sanitize Metadata
     */
    static parse(filename: string, isTvOverride?: boolean): ParsedFilename {
        try {
            // STEP 1: PRE-CLEANING
            let cleaned = filename.replace(/\.(mp4|mkv|avi|mov|webm|flv|m4v|wmv|mpg|mpeg|m2ts|ts|iso)$/i, '');

            // Remove @CC and Websites
            cleaned = cleaned.replace(/@cc/gi, '');
            cleaned = cleaned.replace(/\bwww\.[a-z0-9-]+\.[a-z]{2,}\b/gi, '');

            // Remove brackets/braces that DON'T look like years
            cleaned = cleaned.replace(/\[(?!.*(?:19|20)\d{2}).*?\]/g, '');
            cleaned = cleaned.replace(/\{.*?\}/g, '');

            // Replace separators
            cleaned = cleaned.replace(/[._]/g, ' ');

            // STEP 2: AUTO-DETECT TV STATUS
            // If caller provided override, use it. Otherwise detect.
            let isTv = isTvOverride;
            if (isTv === undefined) {
                isTv = this.TV_PATTERNS.some(p => p.test(cleaned));
            }

            // STEP 3: LIBRARY PARSING
            // Passing isTv is CRITICAL for the library to parse Season/Episode info
            const parsed = filenameParse(cleaned, isTv);

            // STEP 4: METADATA MAPPING & SANITIZATION

            // Quality Construction
            const partsQuality: string[] = [];
            if (parsed.resolution) {partsQuality.push(parsed.resolution);}

            // Source: Filter out junk
            if (parsed.sources && parsed.sources.length > 0) {
                const uniqueSources = [...new Set(parsed.sources)]; // resizing
                partsQuality.push(uniqueSources.join(' '));
            }

            if (parsed.videoCodec) {partsQuality.push(parsed.videoCodec);}

            if (parsed.edition) {
                Object.keys(parsed.edition).forEach(k => {
                    // @ts-ignore
                    if (parsed.edition[k]) {partsQuality.push(k.toUpperCase());}
                });
            }
            if (parsed.revision) {
                Object.keys(parsed.revision).forEach(k => {
                    // @ts-ignore
                    if (parsed.revision[k]) {
                        // Filter out generic terms like "VERSION" which the library often returns
                        if (k.toUpperCase() !== 'VERSION') {
                            partsQuality.push(k.toUpperCase());
                        }
                    }
                });
            }

            let quality = partsQuality.join(' ').trim();

            // Group Construction
            const partsGroup: string[] = [];
            if (parsed.group) {
                // Filter out "AUDIO" if it appears as a group (library sometimes mistakes audio tags for groups)
                if (parsed.group.toUpperCase() !== 'AUDIO') {
                    partsGroup.push(parsed.group);
                }
            }
            if (parsed.audioCodec) {partsGroup.push(parsed.audioCodec);}
            if (parsed.audioChannels) {partsGroup.push(parsed.audioChannels);}

            let group = partsGroup.join(' ').trim();

            // Final Title Cleanup
            let title = parsed.title;
            if (title) {
                // Letters and digits in any script: an [a-zA-Z0-9] trim ate the whole
                // title of anything not written in Latin, leaving only "2001 1080p".
                //
                // Not the whole story. video-filename-parser's title patterns separate
                // fields with [-_\W], and JS \W counts every non-ASCII letter, so a lazy
                // (?<title>.+?) stops after one character and the rest of a Cyrillic,
                // Devanagari or CJK title is eaten as separators -- "Амели.2001" parses
                // to "А". Fixing that means making those patterns Unicode-aware
                // (\P{L} with the u flag) in src/utils/video-filename-parser/title.js,
                // or falling back to the cleaned filename when the parsed title is a
                // degenerate prefix of it. See the failing test in filenameParser.test.ts.
                // "The Boys (2026)": the trim below would take the ")" and leave "The Boys (2026".
                title = title.replace(/\s*[([]\s*(?:19|20)\d{2}\s*[)\]]?\s*$/, '');
                title = title.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
                title = title.replace(/\s+/g, ' ').trim();
            }

            // Internal Fallback
            if (!title || title.trim() === '') {
                title = cleaned.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
            }

            return {
                title: title,
                year: parsed.year ? (typeof parsed.year === 'string' ? parseInt(parsed.year, 10) : parsed.year as number) : undefined,
                isTVShow: parsed.isTv || false,
                season: (parsed as any).seasons?.[0],
                episode: (parsed as any).episodeNumbers?.[0],
                fullSeason: (parsed as any).fullSeason || false,
                quality: quality,
                group: group,
            };
        } catch (error) {
            console.warn('[FilenameParser] Parsing error, falling back:', error);
            const fallbackTitle = filename.replace(/\.(mp4|mkv|avi|mov|webm|flv|m4v|wmv|mpg|mpeg|m2ts|ts|iso)$/i, '')
                .replace(/[._]/g, ' ')
                .replace(/@cc/gi, '')
                .trim();
            return {
                title: fallbackTitle,
                isTVShow: false,
                year: undefined,
            };
        }
    }
}
