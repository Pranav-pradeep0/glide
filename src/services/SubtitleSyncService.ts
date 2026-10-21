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

    /**
     * Lower case, no tags or punctuation of any script (Latin, CJK, Arabic, Devanagari), and
     * every run of whitespace -- line breaks included -- one space, so words split on ' '.
     */
    private static normalize(text: string): string {
        return text
            .toLowerCase()
            .replace(/<[^>]*>|\{[^}]*\}/g, '')
            .replace(/[.,\/#!?$%\^&\*;:{}=\-_`~()'"…–—¡¿«»“”‘’„。、，！？：；「」『』（）［］【】・〜～‥،؛؟।॥]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * What fuzzy matching compares: words, or for scripts written without spaces (Chinese,
     * Japanese, Thai, Lao, Khmer, Burmese) every pair of adjacent characters, since a "word"
     * there is the whole line.
     */
    private static tokens(text: string): string[] {
        if (/[฀-໿က-႟ក-៿぀-ヿ㐀-䶿一-鿿豈-﫿]/.test(text)) {
            const chars = Array.from(text.replace(/ /g, ''));
            return chars.slice(1).map((c, i) => chars[i] + c);
        }
        return text.split(' ').filter(w => w.length > 2);
    }

    /** [needle] as whole words of [hay]; both normalized, so a word boundary is a space or an end. */
    private static wholeWords(hay: string, needle: string): boolean {
        return ` ${hay} `.includes(` ${needle} `);
    }

    private static calculateScore(cueText: string, query: string, cue: SubtitleCue, currentTime: number): { score: number } {
        const normalizedCue = cueText; // Assumed already normalized by caller to save perf
        const normalizedQuery = query;

        let bestScore = 0;
        // A cue of only punctuation ("...") normalizes to '', which every query "includes".
        if (!normalizedCue) { return { score: 0 }; }

        // 1. EXACT INCLUSION
        const cueInQuery = normalizedQuery.includes(normalizedCue);
        const queryInCue = normalizedCue.includes(normalizedQuery);

        if (cueInQuery || queryInCue) {
            let score = 100;

            // Whole words, not part of one. Not \b: in JS it only knows ASCII letters, so it
            // splits Hindi or Arabic mid-word and never rewarded a whole-word match there.
            if (this.wholeWords(normalizedCue, normalizedQuery) || this.wholeWords(normalizedQuery, normalizedCue)) {
                score += 50;
            }

            const timeDiff = Math.abs(cue.startTime - currentTime);
            const proximityBonus = Math.max(0, 50 - (timeDiff / 2));

            bestScore = score + proximityBonus;
            // Return immediately for exact matches as they are highest priority
            return { score: bestScore };
        }

        // 2. FUZZY MATCHING
        const queryWords = this.tokens(normalizedQuery);
        const cueWords = this.tokens(normalizedCue);

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
