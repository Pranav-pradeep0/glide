import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@dr.pogodin/react-native-fs', () => ({
    exists: jest.fn(async () => false),
    readFile: jest.fn(async () => ''),
    copyFile: jest.fn(async () => {}),
    unlink: jest.fn(async () => {}),
    CachesDirectoryPath: '/mock/cache',
}));

jest.mock('@react-native-documents/picker', () => ({
    pick: jest.fn(async () => []),
}));

const mockStore = new Map<string, string>();
jest.mock('react-native-mmkv', () => ({
    createMMKV: () => ({
        set: (k: string, v: string) => mockStore.set(k, v),
        getString: (k: string) => mockStore.get(k),
        remove: (k: string) => mockStore.delete(k),
    }),
}));


jest.mock('../src/store/appStore', () => ({
    useAppStore: { getState: () => ({ settings: { onlineLyricsEnabled: true } }) },
}));

jest.mock('../src/services/AudioMediaService', () => ({
    AudioMediaService: { getEmbeddedLyrics: async (_uri?: string, path?: string) => (path === '/embedded.mp3' ? '[00:01.00]Tagged' : null) },
}));
import { INSTRUMENTAL, LyricsServiceClass, isLyricsSynced, parseLrc, parsePlainLyrics, withInstrumentalBreaks } from '../src/services/LyricsService';

describe('LyricsService parser and sync tests', () => {
    it('parsePlainLyrics marks lines with time: -1', () => {
        const plain = 'First line\nSecond line\nThird line';
        const result = parsePlainLyrics(plain);
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ time: -1, text: 'First line' });
        expect(result[1]).toEqual({ time: -1, text: 'Second line' });
        expect(result[2]).toEqual({ time: -1, text: 'Third line' });
    });

    it('parseLrc correctly parses timed lines', () => {
        const lrc = '[00:12.50] Hello world\n[01:05.10] Second cue';
        const result = parseLrc(lrc);
        expect(result).toHaveLength(2);
        expect(result[0].time).toBeCloseTo(12.5);
        expect(result[0].text).toBe('Hello world');
        expect(result[1].time).toBeCloseTo(65.1);
        expect(result[1].text).toBe('Second cue');
    });

    it('isLyricsSynced correctly identifies unsynced vs synced lyrics', () => {
        expect(isLyricsSynced(null)).toBe(false);
        expect(isLyricsSynced([])).toBe(false);

        const plainLyrics = parsePlainLyrics('Line 1\nLine 2');
        expect(isLyricsSynced(plainLyrics)).toBe(false);

        const timedLyrics = parseLrc('[00:05.00] Line 1\n[00:10.00] Line 2');
        expect(isLyricsSynced(timedLyrics)).toBe(true);
    });

    it('preserves non-Latin scripts (Japanese, Hindi, Arabic) in unicode normalisation', () => {
        const clean = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, '');

        // Japanese
        expect(clean('宇多田ヒカル (Utada Hikaru)')).toBe('宇多田ヒカルutadahikaru');
        // Hindi
        expect(clean('अरिजीत सिंह - Kesariya')).toBe('अरिजीतसिंहkesariya');
        // Arabic
        expect(clean('عمرو دياب [Amr Diab]')).toContain('دياب');
        // Pure punctuation / spaces becomes empty
        expect(clean('--- ... !!!')).toBe('');
    });
});

describe('withInstrumentalBreaks', () => {
    it('marks the intro, blank lines and long gaps with one ♪ each', () => {
        const lines = parseLrc([
            '[00:12.00]First line',
            '[00:15.00]',
            '[00:16.00]',
            '[00:20.00]Second line',
            '[00:24.00]Third line',
            '[00:50.00]After the solo',
        ].join('\n'));
        expect(withInstrumentalBreaks(lines)).toEqual([
            { time: 0, text: INSTRUMENTAL },
            { time: 12, text: 'First line' },
            { time: 15, text: INSTRUMENTAL },
            { time: 20, text: 'Second line' },
            { time: 24, text: 'Third line' },
            { time: 30, text: INSTRUMENTAL },
            { time: 50, text: 'After the solo' },
        ]);
    });

    it('leaves unsynced lyrics and a short intro alone', () => {
        const plain = parsePlainLyrics('One\nTwo');
        expect(withInstrumentalBreaks(plain)).toBe(plain);
        expect(withInstrumentalBreaks(parseLrc('[00:02.00]Hi\n[00:05.00]There'))[0].text).toBe('Hi');
    });
});

describe('LyricsService online lookup', () => {
    const track = { id: 't1', title: 'Song', artist: 'Band', duration: 200 };
    const notFound = { ok: false, status: 404, json: async () => ({}) };
    const emptySearch = { ok: true, status: 200, json: async () => [] };
    let fetchMock: jest.Mock<any>;

    beforeEach(() => {
        fetchMock = jest.fn();
        (globalThis as any).fetch = fetchMock;
    });

    it('asks again after LRCLIB could not be reached', async () => {
        const service = new LyricsServiceClass();
        fetchMock.mockRejectedValue(new Error('offline'));
        expect(await service.getLyricsForTrack(track)).toBeNull();

        fetchMock.mockReset();
        fetchMock.mockResolvedValueOnce(notFound).mockResolvedValueOnce(emptySearch);
        expect(await service.getLyricsForTrack(track)).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('remembers a real "not found" for the session', async () => {
        const service = new LyricsServiceClass();
        fetchMock.mockResolvedValueOnce(notFound).mockResolvedValueOnce(emptySearch);
        expect(await service.getLyricsForTrack(track)).toBeNull();
        expect(await service.getLyricsForTrack(track)).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('LyricsService storage', () => {
    beforeEach(() => {
        mockStore.clear();
        (globalThis as any).fetch = jest.fn(async () => ({
            ok: true, status: 200, json: async () => ({ syncedLyrics: '[00:01.00]Hi' }),
        }));
    });

    it('does not copy embedded lyrics into storage', async () => {
        const service = new LyricsServiceClass();
        const lines = await service.getLyricsForTrack({ id: 'e1', path: '/embedded.mp3' });
        expect(lines?.[0].text).toBe('Tagged');
        expect(mockStore.has('lyrics_e1')).toBe(false);
    });

    it('keeps at most 500 downloads, dropping the oldest', async () => {
        const service = new LyricsServiceClass();
        for (let i = 0; i <= 500; i++) {
            await service.getLyricsForTrack({ id: `t${i}`, title: 'Song', artist: 'Band' });
        }
        expect(mockStore.has('lyrics_t0')).toBe(false);
        expect(mockStore.has('lyrics_t1')).toBe(true);
        expect(mockStore.has('lyrics_t500')).toBe(true);
    });
});
