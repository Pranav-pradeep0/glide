// Chapters a viewer can skip: an intro or a recap, recognised by its name.
// Only a named chapter counts; a wrong "Skip intro" that jumps past the story is worse
// than none, so nothing is guessed from the picture.

export type SkipKind = 'intro' | 'recap';

export interface SkipRange {
    kind: SkipKind;
    /** Seconds; the skip lands on end, the next chapter's start. */
    start: number;
    end: number;
}

const INTRO = /\b(intro|opening|op|title sequence)\b/i;
const RECAP = /\b(recap|previously)\b/i;
/** Longer than this is story: a film's first chapter can be called "Opening". */
const MAX_SKIP_SECONDS = 180;

/** chapters by start, in seconds. */
export function findSkips(chapters: { title: string; start: number }[], durationSeconds: number): SkipRange[] {
    const skips: SkipRange[] = [];
    for (let i = 0; i < chapters.length - 1; i++) {
        const { title, start } = chapters[i];
        const end = chapters[i + 1].start;
        if (start > durationSeconds / 3 || end - start > MAX_SKIP_SECONDS) {continue;}
        const kind = RECAP.test(title) ? 'recap' : INTRO.test(title) ? 'intro' : null;
        if (kind) {skips.push({ kind, start, end });}
    }
    return skips;
}

/** The range playing at t, or -1. */
export function skipIndexAt(skips: SkipRange[], t: number): number {
    return skips.findIndex(s => t >= s.start && t < s.end);
}
