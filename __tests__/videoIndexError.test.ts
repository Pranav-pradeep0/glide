import { expect, it, jest } from '@jest/globals';

const mockGetAllVideos = jest.fn<any>();
jest.mock('../src/services/MediaService', () => ({
    MediaService: { getAllVideos: mockGetAllVideos, onChange: jest.fn() },
}));

const { useVideoIndexStore } = require('../src/store/videoIndexStore') as typeof import('../src/store/videoIndexStore');

it('flags a failed index load and clears it on a successful retry', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetAllVideos.mockRejectedValueOnce(new Error('boom'));
    await useVideoIndexStore.getState().initialize();
    expect(useVideoIndexStore.getState().indexError).toBe(true);
    expect(useVideoIndexStore.getState().isIndexReady).toBe(false);

    mockGetAllVideos.mockResolvedValueOnce([]);
    await useVideoIndexStore.getState().initialize();
    expect(useVideoIndexStore.getState().indexError).toBe(false);
    expect(useVideoIndexStore.getState().isIndexReady).toBe(true);
});
