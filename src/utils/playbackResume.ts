/** Positions at the opening second or final second are starts/finishes, not resumes. */
const RESUME_EDGE_GUARD_SECONDS = 1;

export function getResumablePosition(
    position: number | null | undefined,
    duration: number | null | undefined
): number | null {
    if (typeof position !== 'number'
        || typeof duration !== 'number'
        || !Number.isFinite(position)
        || !Number.isFinite(duration)
        || duration <= 0
        || position <= RESUME_EDGE_GUARD_SECONDS
        || position >= duration - RESUME_EDGE_GUARD_SECONDS) {
        return null;
    }

    return position;
}

/** Watched to the end (or marked so): no resume prompt, a full progress bar, not "Continue watching". */
export function isFinished(position: number, duration: number): boolean {
    return duration > 0 && position >= duration - RESUME_EDGE_GUARD_SECONDS;
}
