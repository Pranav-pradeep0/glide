import { describe, expect, it, jest } from '@jest/globals';

const mockStore = new Map<string, string>();
jest.mock('react-native-mmkv', () => ({
    createMMKV: () => ({
        set: (k: string, v: string) => mockStore.set(k, v),
        getString: (k: string) => mockStore.get(k),
        remove: (k: string) => mockStore.delete(k),
    }),
}));

import { prune } from '../src/store/videoHistoryStore';
import { VideoHistoryEntry } from '../src/types';

// The whole history is rewritten on every save, so its size is the cost of saving a
// resume position. Nothing ever removed an entry before this.

function entry(i: number, bookmarks = 0): VideoHistoryEntry {
    return {
        videoPath: `/videos/${i}.mp4`,
        videoName: `${i}.mp4`,
        videoId: `${i}.mp4`,
        lastWatchedTime: i,
        lastPausedPosition: 0,
        duration: 100,
        viewCount: 1,
        bookmarks: Array.from({ length: bookmarks }, (_, b) => ({
            id: `${i}-${b}`,
            timestamp: b,
            createdAt: 0,
        })),
    };
}

function asMap(entries: VideoHistoryEntry[]) {
    return new Map(entries.map((e) => [e.videoPath, e]));
}

describe('video history prune', () => {
    it('leaves a history under the cap exactly as it is', () => {
        const all = Array.from({ length: 10 }, (_, i) => entry(i));
        expect(prune(asMap(all))).toHaveLength(10);
    });

    it('drops the oldest once over the cap', () => {
        const all = Array.from({ length: 600 }, (_, i) => entry(i));
        const kept = prune(asMap(all));

        expect(kept).toHaveLength(500);
        // lastWatchedTime is the index here, so the newest 500 are 100..599.
        expect(Math.min(...kept.map((e) => e.lastWatchedTime))).toBe(100);
    });

    it('keeps a bookmarked video however old it is', () => {
        const all = Array.from({ length: 600 }, (_, i) => entry(i, i === 0 ? 1 : 0));
        const kept = prune(asMap(all));

        expect(kept).toHaveLength(500);
        expect(kept.some((e) => e.videoPath === '/videos/0.mp4')).toBe(true);
    });
});
