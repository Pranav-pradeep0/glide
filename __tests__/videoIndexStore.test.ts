import { describe, expect, it, jest } from '@jest/globals';

const mockGetAllVideos = jest.fn<any>();
jest.mock('../src/services/MediaService', () => ({
    MediaService: { getAllVideos: mockGetAllVideos, onChange: jest.fn() },
}));

const { useVideoIndexStore } = require('../src/store/videoIndexStore') as typeof import('../src/store/videoIndexStore');

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('videoIndexStore', () => {
    it('loads again when asked while a scan is already running', async () => {
        let finishFirst!: (v: unknown[]) => void;
        mockGetAllVideos.mockReturnValueOnce(new Promise((r) => { finishFirst = r; }));
        mockGetAllVideos.mockResolvedValueOnce([{ name: 'new.mp4' }]);

        const first = useVideoIndexStore.getState().initialize();
        useVideoIndexStore.getState().initialize(); // a change arrives mid-scan
        finishFirst([]);
        await first;
        await flush();

        expect(mockGetAllVideos).toHaveBeenCalledTimes(2);
        expect(useVideoIndexStore.getState().videos).toEqual([{ name: 'new.mp4' }]);
    });
});
