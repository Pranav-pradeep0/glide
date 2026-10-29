// src/services/SubtitleSelectionService.ts

import { SubtitleTrack } from '../utils/SubtitleExtractor';
import { SubtitleCue } from '../types';

const LOG_PREFIX = '[SubtitleSelection]';

// Keywords that indicate SDH content in track names
const SDH_NAME_KEYWORDS = [
    'sdh', 'cc', 'closed caption', 'closed.caption', 'hearing impaired',
    'hearing-impaired', 'hearingimpaired', 'hoh', 'deaf', 'hard of hearing',
];

// Patterns that indicate SDH content in subtitle text
const SDH_CONTENT_PATTERNS = [
    /\[.+?\]/,                    // [sound effect], [music]
    /\(.+?(playing|sfx|sound|music|noise|effect|sigh|gasp|laugh|cry|scream|whisper|grunt|cough).*?\)/i,  // (music playing)
    /\(\w+\s+(sighs|laughs|coughs|gasps|crying|screaming|whispering)\)/i,  // (John sighs)
    /♪|♫|🎵/,                      // Music symbols
    /\*+.+?\*+/,                  // *sound effect*
    /:$/m,                         // Speaker labels ending with colon
    /^-\s*\[/m,                   // Dialog starting with - [
];

interface ScoredTrack {
    track: SubtitleTrack;
    score: number;
    reason: string;
}

export class SubtitleSelectionService {
    /**
     * Score embedded subtitle tracks for SDH likelihood
     */
    static scoreEmbeddedTracks(tracks: SubtitleTrack[], preferredLang: string = 'en'): ScoredTrack[] {
        const scored: ScoredTrack[] = [];

        for (const track of tracks) {
            let score = 0;
            const reasons: string[] = [];

            const title = (track.title || '').toLowerCase();
            const lang = (track.language || '').toLowerCase();

            // Check title for SDH keywords
            for (const keyword of SDH_NAME_KEYWORDS) {
                if (title.includes(keyword)) {
                    score += 20;
                    reasons.push(`Title contains '${keyword}'`);
                    break;
                }
            }

            // Language preference
            if (lang === preferredLang || lang.startsWith(preferredLang)) {
                score += 10;
                reasons.push('Matches preferred language');
            }

            // Default track bonus
            if (track.isDefault) {
                score += 5;
                reasons.push('Default track');
            }

            // Penalize forced tracks (typically for foreign dialogue only)
            if (track.isForced) {
                score -= 15;
                reasons.push('Forced track penalty');
            }

            scored.push({
                track,
                score,
                reason: reasons.join(', ') || 'No specific indicators',
            });
        }

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        if (__DEV__) {console.log(`${LOG_PREFIX} Scored ${tracks.length} embedded tracks`);}
        return scored;
    }

    /**
     * Validate subtitle content for SDH patterns
     * This is the KEY function - checks actual content, not just names
     */
    static validateSDHContent(cues: SubtitleCue[]): { isSDH: boolean; confidence: number; matchedPatterns: string[] } {
        if (!cues || cues.length === 0) {
            return { isSDH: false, confidence: 0, matchedPatterns: [] };
        }

        const matchedPatterns: string[] = [];
        let sdhCueCount = 0;
        const sampleSize = Math.min(cues.length, 100); // Check first 100 cues

        for (let i = 0; i < sampleSize; i++) {
            const cue = cues[i];
            const text = cue.text;

            for (const pattern of SDH_CONTENT_PATTERNS) {
                if (pattern.test(text)) {
                    sdhCueCount++;
                    const patternName = pattern.toString().substring(0, 30);
                    if (!matchedPatterns.includes(patternName)) {
                        matchedPatterns.push(patternName);
                    }
                    break; // Count each cue only once
                }
            }
        }

        // Calculate confidence based on percentage of SDH cues
        const ratio = sdhCueCount / sampleSize;
        const confidence = Math.round(ratio * 100);

        // Consider it SDH if at least 5% of cues have SDH patterns
        const isSDH = ratio >= 0.05;

        if (__DEV__) {console.log(`${LOG_PREFIX} Content validation: ${sdhCueCount}/${sampleSize} SDH cues, confidence ${confidence}%`);}

        return { isSDH, confidence, matchedPatterns };
    }

    /**
     * Get the best embedded track that has SDH content (validated by content parsing)
     * This pre-parses multiple tracks to find one with actual SDH content
     */
    static async findBestSDHByContent(
        tracks: SubtitleTrack[],
        extractAndParse: (index: number) => Promise<SubtitleCue[] | null>,
        preferredLang: string = 'en'
    ): Promise<{ track: SubtitleTrack; cues: SubtitleCue[] } | null> {
        // First, filter and sort by name-based scoring
        const scored = this.scoreEmbeddedTracks(tracks, preferredLang);

        // Try each track from highest scored to lowest
        for (const { track, score } of scored) {
            // Skip tracks with very low name-based score unless it's the only option
            if (score < 0 && scored.length > 1) {continue;}

            try {
                if (__DEV__) {console.log(`${LOG_PREFIX} Checking track ${track.index} (${track.title || track.language}) for SDH content...`);}
                const cues = await extractAndParse(track.index);

                if (!cues || cues.length === 0) {continue;}

                // Validate content
                const validation = this.validateSDHContent(cues);

                if (validation.isSDH) {
                    if (__DEV__) {console.log(`${LOG_PREFIX} ✓ Track ${track.index} has SDH content (confidence ${validation.confidence}%)`);}
                    return { track, cues };
                } else {
                    if (__DEV__) {console.log(`${LOG_PREFIX} ✗ Track ${track.index} lacks SDH content`);}
                }
            } catch (error) {
                console.error(`${LOG_PREFIX} Error checking track ${track.index}:`, error);
            }
        }

        if (__DEV__) {console.log(`${LOG_PREFIX} No tracks with verified SDH content found`);}
        return null;
    }
}


