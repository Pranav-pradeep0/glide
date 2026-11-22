// The file's chapters, by start in seconds: which one plays at a time, for the seek bar and the
// Chapters panel. Worklet: the bar and the panel's highlight read it on the UI thread.

export interface Chapter { title: string; start: number }

/** Index of the chapter playing at t, or -1 before the first one starts. */
export const chapterIndexAt = (chapters: Chapter[], t: number) => {
    'worklet';
    let index = -1;
    for (let i = 0; i < chapters.length && chapters[i].start <= t; i++) {index = i;}
    return index;
};
