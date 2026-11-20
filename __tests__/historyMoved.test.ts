import { describe, expect, it, jest } from '@jest/globals';

jest.mock('react-native-mmkv', () => ({
    createMMKV: () => ({ set: () => {}, getString: () => undefined, remove: () => {} }),
}));

import { findMissingHistory, useVideoHistoryStore } from '../src/store/videoHistoryStore';
import { VideoFile, VideoHistoryEntry } from '../src/types';

// Seen on device: a movie watched in Download/Telegram, later moved to Download. Recents
// kept the old path and opened it into "file not found".

const OLD = "/storage/emulated/0/Download/Telegram/It's A Medical Miracle.mkv";
const NEW = "/storage/emulated/0/Download/It's A Medical Miracle.mkv";

function entry(videoPath: string, contentUri?: string): VideoHistoryEntry {
    return {
        videoPath, contentUri, videoName: videoPath.split('/').pop()!, videoId: 'x',
        lastWatchedTime: 1, lastPausedPosition: 600, duration: 7200, viewCount: 1, bookmarks: [],
    };
}

function video(path: string, uri: string): VideoFile {
    return { path, uri, name: path.split('/').pop()!, size: 1, modifiedDate: 0, duration: 7200, isDirectory: false };
}

const nothingOnDisk = async () => false;

describe('history for moved files', () => {
    it('finds a moved file by its name', async () => {
        const { moves, missing } = await findMissingHistory([entry(OLD)], [video(NEW, 'content://m/9')], nothingOnDisk);
        expect(moves).toEqual([[OLD, video(NEW, 'content://m/9')]]);
        expect(missing.size).toBe(0);
    });

    it('prefers the same MediaStore id over a name match', async () => {
        const renamed = video('/storage/emulated/0/Movies/renamed.mkv', 'content://m/1');
        const { moves } = await findMissingHistory([entry(OLD, 'content://m/1')], [renamed, video(NEW, 'content://m/2')], nothingOnDisk);
        expect(moves[0][1]).toBe(renamed);
    });

    it('does not guess between two files with the same name', async () => {
        const lib = [video(NEW, 'content://m/1'), video("/storage/emulated/0/Movies/It's A Medical Miracle.mkv", 'content://m/2')];
        const { moves, missing } = await findMissingHistory([entry(OLD)], lib, nothingOnDisk);
        expect(moves).toEqual([]);
        expect([...missing]).toEqual([OLD]);
    });

    it('does not match a same-named file of a different length', async () => {
        const other = { ...video(NEW, 'content://m/9'), duration: 5400 };
        const { moves } = await findMissingHistory([entry(OLD)], [other], nothingOnDisk);
        expect(moves).toEqual([]);
    });

    it('does not relink files on an SD card that is out', async () => {
        const onCard = "/storage/1A2B-3C4D/Movies/It's A Medical Miracle.mkv";
        const { moves, missing } = await findMissingHistory([entry(onCard)], [video(NEW, 'content://m/9')], nothingOnDisk);
        expect(moves).toEqual([]);
        expect([...missing]).toEqual([onCard]);
        // Card in, file really gone from it: a move again.
        const cardIn = await findMissingHistory([entry(onCard)], [video(NEW, 'content://m/9')], async p => p === '/storage/1A2B-3C4D');
        expect(cardIn.moves).toHaveLength(1);
    });

    it('leaves alone files that are listed, on disk, or not local', async () => {
        const onDisk = '/storage/emulated/0/.hidden/clip.mp4';
        const { moves, missing } = await findMissingHistory(
            [entry(NEW), entry(onDisk), entry('content://m/5')],
            [video(NEW, 'content://m/9')],
            async p => p === onDisk,
        );
        expect(moves).toEqual([]);
        expect(missing.size).toBe(0);
    });

    it('moves the entry, resume point included, to the new path', () => {
        useVideoHistoryStore.setState({ history: new Map([[OLD, entry(OLD)]]) });
        useVideoHistoryStore.getState().relinkMoved([[OLD, video(NEW, 'content://m/9')]]);
        const history = useVideoHistoryStore.getState().history;
        expect(history.has(OLD)).toBe(false);
        expect(history.get(NEW)).toMatchObject({ videoPath: NEW, contentUri: 'content://m/9', lastPausedPosition: 600 });
    });
});

// Seen on device: a video played from the library (/storage/...) and later through
// "Open with" (file:///storage/...) showed twice in Recents.
describe('one entry per file', () => {
    it('matches a file:// path to the same bare path', () => {
        const path = '/storage/emulated/0/Movies/clip.mp4';
        useVideoHistoryStore.setState({ history: new Map() });
        useVideoHistoryStore.getState().incrementViewCount(path, 'clip.mp4');
        useVideoHistoryStore.getState().incrementViewCount(`file://${path}`, 'clip.mp4');
        useVideoHistoryStore.getState().updatePlaybackPosition(`file://${path}`, 'clip.mp4', 30, 60);
        const all = useVideoHistoryStore.getState().getAllHistory();
        expect(all).toHaveLength(1);
        expect(all[0].viewCount).toBe(2);
    });
});

// A content:// URI's last segment is an id (msf:1234), not the file name the entry was saved by.
describe('content:// resume', () => {
    it('finds the entry by name when the URI changed', () => {
        useVideoHistoryStore.setState({ history: new Map() });
        useVideoHistoryStore.getState().updatePlaybackPosition('content://dl/document/msf:1', 'Film.mkv', 300, 6000);
        const store = useVideoHistoryStore.getState();
        expect(store.getVideoHistory('content://dl/document/msf:2', 'Film.mkv')?.lastPausedPosition).toBe(300);
        store.clearVideoHistory('content://dl/document/msf:2', 'Film.mkv');
        expect(useVideoHistoryStore.getState().getAllHistory()).toHaveLength(0);
    });
});
