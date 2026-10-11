import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { searchAllSubtitles } from '../src/utils/subdlApi';
import * as network from '../src/utils/network';

jest.mock('@dr.pogodin/react-native-fs', () => ({
    CachesDirectoryPath: '/mock/cache/dir',
    downloadFile: jest.fn(),
    stopDownload: jest.fn(),
    exists: jest.fn(),
    mkdir: jest.fn(),
    readDir: jest.fn(),
    readFile: jest.fn(),
    unlink: jest.fn(),
}));

jest.mock('../src/utils/network', () => {
    return {
        createCoalescedRequest: jest.fn((map: any, key: any, factory: any, signal: any) => factory(signal)),
        fetchWithTimeout: jest.fn(),
        isAbortError: jest.fn(),
        NetworkTimeoutError: class extends Error {
            timeoutMs = 0;
            constructor(ms: number) {
                super('timeout');
                this.timeoutMs = ms;
            }
        },
    };
});

describe('subdlApi', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns empty array on empty response', async () => {
        (network.fetchWithTimeout as jest.Mock<any>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({}),
        } as any);

        const result = await searchAllSubtitles('Test.Movie.mkv');
        expect(result.subtitles).toEqual([]);
    });

    it('parses and maps response correctly', async () => {
        (network.fetchWithTimeout as jest.Mock<any>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                subtitles: [
                    {
                        sd_id: 'sub1',
                        name: 'Test Sub',
                        lang: 'en',
                        release_name: 'Test.Release',
                        url: 'http://dl.com/sub.zip',
                        author: 'Tester',
                        rating: 5,
                        hi: false,
                        comment: 'Good sub'
                    }
                ]
            }),
        } as any);

        const result = await searchAllSubtitles('Test.Movie.mkv');
        expect(result.subtitles).toHaveLength(1);
        expect(result.subtitles[0]).toMatchObject({
            id: 'sub1',
            name: 'Test Sub',
            language: 'en',
            release: 'Test.Release',
            downloadUrl: 'http://dl.com/sub.zip',
            author: 'Tester',
            rating: 5,
            hearingImpaired: false,
        });
    });

    it('calculates SDH score properly', async () => {
        (network.fetchWithTimeout as jest.Mock<any>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                subtitles: [
                    {
                        sd_id: 'sub1',
                        release_name: 'Movie.SDH.1080p',
                        comment: 'includes sounds for deaf',
                        hi: true
                    },
                    {
                        sd_id: 'sub2',
                        release_name: 'Movie.1080p',
                        comment: 'normal sub',
                        hi: false
                    }
                ]
            }),
        } as any);

        const result = await searchAllSubtitles('Test.Movie.mkv', 'en', undefined, true);
        expect(result.subtitles).toHaveLength(2);
        
        // SDH subtitle should be sorted first when prioritizeSDH is true
        expect(result.subtitles[0].id).toBe('sub1');
        expect(result.subtitles[0].sdhScore).toBeGreaterThan(10);
        
        expect(result.subtitles[1].id).toBe('sub2');
        expect(result.subtitles[1].sdhScore).toBe(0);
    });

    it('rejects on a network failure instead of reporting no results', async () => {
        (network.fetchWithTimeout as jest.Mock<any>).mockRejectedValueOnce(new Error('Network failure'));
        await expect(searchAllSubtitles('Test.Movie.mkv')).rejects.toThrow('Network failure');
    });
});
