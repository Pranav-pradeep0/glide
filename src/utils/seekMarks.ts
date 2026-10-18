// Bookmarks and chapter starts on the seek bar: where a release lands, and when a drag ticks.
// Worklets: both run on the UI thread inside the seek bar's pan gesture.

/** The mark nearest t within radius (seconds), or -1 when none is that close. */
export const nearestMark = (marks: number[], t: number, radius: number) => {
    'worklet';
    let best = -1;
    let bestDistance = radius;
    for (let i = 0; i < marks.length; i++) {
        const d = Math.abs(marks[i] - t);
        if (d <= bestDistance) {
            best = marks[i];
            bestDistance = d;
        }
    }
    return best;
};

/** Whether moving from → to passes a mark. */
export const crossesMark = (marks: number[], from: number, to: number) => {
    'worklet';
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    for (let i = 0; i < marks.length; i++) {
        if (marks[i] > lo && marks[i] <= hi) {return true;}
    }
    return false;
};
