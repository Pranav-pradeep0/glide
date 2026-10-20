/** Native's onAudioSkippedUnplayable: a song that would not play, and what the player did next. */
export interface UnplayableEvent {
    title: string;
    /** Moved on to the next song; false when playback stopped there. */
    skipped: boolean;
    /** Every song in a queue of two or more failed in a row. */
    allFailed: boolean;
}

/** Long enough for a run of bad files to arrive as one, short enough to still read as "now". */
export const UNPLAYABLE_BATCH_MS = 600;
const MAX_TITLE = 40;

const clip = (title: string) => {
    const t = title.trim() || 'this song';
    return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 1).trimEnd()}…` : t;
};

export function unplayableText(events: UnplayableEvent[]): string {
    const last = events[events.length - 1];
    if (last.allFailed) { return "Nothing in this queue can play"; }
    if (events.length > 1) { return `Skipped ${events.length} songs that can't play`; }
    return last.skipped ? `Can't play ${clip(last.title)}, skipped` : `Can't play ${clip(last.title)}`;
}

/**
 * One toast per run of failures, not one per song: skips are held for [UNPLAYABLE_BATCH_MS]
 * after the latest, and a stop shows at once. Nothing is shown, or kept for later, while
 * the app is in the background.
 */
export function createUnplayableNotifier(show: (text: string) => void, isActive: () => boolean) {
    let pending: UnplayableEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
        clearTimeout(timer);
        timer = undefined;
        const events = pending;
        pending = [];
        if (events.length && isActive()) { show(unplayableText(events)); }
    };
    return (event: UnplayableEvent) => {
        if (!isActive()) { pending = []; clearTimeout(timer); return; }
        pending.push(event);
        clearTimeout(timer);
        if (event.skipped && !event.allFailed) { timer = setTimeout(flush, UNPLAYABLE_BATCH_MS); } else { flush(); }
    };
}
