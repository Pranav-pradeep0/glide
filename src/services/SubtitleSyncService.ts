import { SubtitleCue } from '../types';

export interface MatchResult {
    cue: SubtitleCue;
    matchedText: string;
}

interface InternalMatchResult extends MatchResult {
    score: number;
}

export class SubtitleSyncService {
    private static MAX_WINDOW_MINUTES = 5;
    private static WINDOW_STEPS = [1, 2, 3, 5];

    /**
     * Finds matching cues near the current playback time.
     * Searches in expanding windows to prioritize proximity and avoid duplicates.
     */
    static findMatchingCues(
        cues: SubtitleCue[],
        query: string,
        currentTime: number
    ): MatchResult[] {
        if (!query || query.trim().length < 2) { return []; }

        const normalizedQuery = this.normalize(query);

        for (const windowMinutes of this.WINDOW_STEPS) {
            const windowSeconds = windowMinutes * 60;
            const startTime = Math.max(0, currentTime - windowSeconds);
            const endTime = currentTime + windowSeconds;

            const windowResults = this.searchInWindow(cues, normalizedQuery, startTime, endTime, currentTime);

            if (windowResults.length > 0) {
                // If we found good matches in a smaller window, we stop here to avoid
                // confusion with similar phrases further away in the movie.
                // Strip score before returning
                return windowResults.slice(0, 5).map(({ score: _, ...rest }) => rest);
            }
        }

        return [];
    }

    private static searchInWindow(
        cues: SubtitleCue[],
        normalizedQuery: string,
        startTime: number,
        endTime: number,
        currentTime: number
    ): InternalMatchResult[] {
        const matches: InternalMatchResult[] = [];

        // Find cues within window
        const relevantCues = cues.filter(c =>
            (c.startTime >= startTime && c.startTime <= endTime) ||
            (c.endTime >= startTime && c.endTime <= endTime)
        );

        for (const cue of relevantCues) {
            const normalizedCueText = this.normalize(cue.text);
            const { score } = this.calculateScore(normalizedCueText, normalizedQuery, cue, currentTime);

            if (score > 0) {
                matches.push({
                    cue,
                    score,
                    matchedText: cue.text,
                });
            }
        }

        // Sort by score then proximity
        return matches.sort((a, b) => {
            if (Math.abs(b.score - a.score) > 10) { return b.score - a.score; }
            return Math.abs(a.cue.startTime - currentTime) - Math.abs(b.cue.startTime - currentTime);
        });
    }

    private static normalize(text: string): string {
        return text
            .toLowerCase()
            .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    private static calculateScore(cueText: string, query: string, cue: SubtitleCue, currentTime: number): { score: number } {
        const normalizedCue = cueText; // Assumed already normalized by caller to save perf
        const normalizedQuery = query;

        let bestScore = 0;

        // 1. EXACT INCLUSION
        const cueInQuery = normalizedQuery.includes(normalizedCue);
        const queryInCue = normalizedCue.includes(normalizedQuery);

        if (cueInQuery || queryInCue) {
            let score = 100;

            // Boundary checks
            const escapedQuery = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const escapedCue = normalizedCue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const boundaryRegex = new RegExp(`\\b${escapedQuery}\\b`, 'i');
            const reverseBoundaryRegex = new RegExp(`\\b${escapedCue}\\b`, 'i');

            if (boundaryRegex.test(normalizedCue) || reverseBoundaryRegex.test(normalizedQuery)) {
                score += 50;
            }

            const timeDiff = Math.abs(cue.startTime - currentTime);
            const proximityBonus = Math.max(0, 50 - (timeDiff / 2));

            bestScore = score + proximityBonus;
            // Return immediately for exact matches as they are highest priority
            return { score: bestScore };
        }

        // 2. FUZZY MATCHING
        const queryWords = normalizedQuery.split(' ').filter(w => w.length > 2);
        const cueWords = normalizedCue.split(' ').filter(w => w.length > 2);

        if (queryWords.length > 0 && cueWords.length > 0) {
            let matches = 0;
            // Simple word overlap
            for (const word of queryWords) {
                if (normalizedCue.includes(word)) { matches++; }
            }

            const denominator = Math.min(queryWords.length, cueWords.length);
            if (denominator > 0) {
                const matchRate = matches / denominator;
                if (matchRate >= 0.5) {
                    const matchLengthBonus = Math.min(matches * 5, 20);
                    bestScore = (matchRate * 80) + matchLengthBonus;
                }
            }
        }

        return { score: bestScore };
    }

    /**
     * The delay in ms that shows [cue] at [currentTime], keeping the frame-rate [ratio]:
     * cue.startTime * ratio + delay = currentTime. Positive shows subtitles later.
     */
    static calculateOffset(cue: SubtitleCue, currentTime: number, ratio = 1): number {
        return Math.round((currentTime - cue.startTime * ratio) * 1000);
    }

    /** The subtitle time shown at video time [videoTime]: a cue at c is shown at c * ratio + delay. */
    static cueTimeAt(videoTime: number, delayMs: number, ratio = 1): number {
        return (videoTime - delayMs / 1000) / ratio;
    }


}
