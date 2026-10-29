import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('react-native-mmkv', () => ({
    createMMKV: () => ({ set: () => {}, getString: () => undefined, remove: () => {} }),
}));

import { isReplayable, replayParams, useVideoHistoryStore } from '../src/store/videoHistoryStore';

// Step (e) of docs/network-shares.md: shares and app links in Recents, keyed by their path.

const store = () => useVideoHistoryStore.getState();
const recents = () => store().getAllHistory().map(e => e.videoPath);

describe('history for shares and app links', () => {
    beforeEach(() => store().clearAllHistory());

    it('knows what Recents can open again', () => {
        expect(isReplayable('/storage/emulated/0/Movies/a.mkv')).toBe(true);
        expect(isReplayable('smb://192.168.1.37/GlideTest/Spider-Man.mkv')).toBe(true);
        expect(isReplayable('https://torrentio.strem.fun/resolve/realdebrid/x/y/1/a.mkv')).toBe(true);
        expect(isReplayable('http://127.0.0.1:11470/abc/0')).toBe(false);
        expect(isReplayable('http://LOCALHOST:11470/abc/0')).toBe(false);
        expect(isReplayable('content://media/external/video/media/12')).toBe(false);
        expect(isReplayable('rtsp://cam/live')).toBe(false);
    });

    it('keeps the same file name on two shares apart', () => {
        const a = 'smb://192.168.1.37/TV/S01E01.mkv';
        const b = 'smb://192.168.1.50/Media/S01E01.mkv';
        store().incrementViewCount(a, 'S01E01.mkv');
        store().incrementViewCount(b, 'S01E01.mkv');
        store().updatePlaybackPosition(b, 'S01E01.mkv', 600, 2400);
        expect(recents().sort()).toEqual([a, b]);
        expect(store().getVideoHistory(a)?.lastPausedPosition).toBe(0);
        expect(store().getVideoHistory(b)?.lastPausedPosition).toBe(600);
    });

    it('keeps secure links titled alike apart and replays them with their headers', () => {
        const one = 'https://debrid.example/d/one';
        const two = 'https://debrid.example/d/two';
        const headers = { Authorization: 'Bearer t' };
        store().incrementViewCount(one, 'Video', undefined, undefined, { headers, secureUri: true });
        store().incrementViewCount(two, 'Video', undefined, undefined, { secureUri: true });
        expect(recents().sort()).toEqual([one, two]);
        expect(replayParams(store().getVideoHistory(one)!)).toEqual({ videoName: 'Video', external: { headers, secureUri: true } });
        expect(replayParams(store().getVideoHistory(two)!).external).toEqual({ headers: undefined, secureUri: true });
    });

    it('a plain link replays with no external params', () => {
        const url = 'https://cdn.example/film.mp4';
        store().updatePlaybackPosition(url, 'film.mp4', 60, 600);
        expect(recents()).toEqual([url]);
        expect(replayParams(store().getVideoHistory(url)!).external).toBeUndefined();
    });

    it("keeps the sending app's local server and content:// out of Recents", () => {
        store().incrementViewCount('http://127.0.0.1:11470/abc/0', 'Film');
        store().updatePlaybackPosition('http://127.0.0.1:11470/abc/0', 'Film', 60, 600);
        store().updatePlaybackPosition('content://media/external/video/media/12', 'clip.mp4', 30, 90);
        expect(recents()).toEqual([]);
    });
});
