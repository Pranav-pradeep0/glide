import { expect, it, jest } from '@jest/globals';

const DAY = 24 * 60 * 60 * 1000;
const file = (path: string, ageDays: number) => ({
    name: path.split('/').pop(), path, isFile: () => true, mtime: new Date(Date.now() - ageDays * DAY),
});
const mockUnlink = jest.fn(async (_path: string) => {});

jest.mock('@dr.pogodin/react-native-fs', () => ({
    CachesDirectoryPath: '/cache',
    readDir: jest.fn(async (dir: string) => ({
        '/cache/thumbnails2': [file('/cache/thumbnails2/new.jpg', 1), file('/cache/thumbnails2/old.jpg', 40)],
        '/cache/video_thumbs2': [file('/cache/video_thumbs2/old.jpg', 31)],
    } as Record<string, unknown[]>)[dir] ?? []),
    unlink: (path: string) => mockUnlink(path),
}));
jest.mock('../libs/react-native-simple-thumbnail', () => ({}));
jest.mock('../src/services/FileService', () => ({ FileService: { ensureDir: async () => {} } }));
jest.mock('../src/services/MediaService', () => ({ MediaService: {} }));
jest.mock('../src/services/TelegramService', () => ({ isTelegram: () => false, TelegramService: {} }));
jest.mock('@/store/videoHistoryStore', () => ({
    useVideoHistoryStore: { getState: () => ({ history: new Map() }) },
}));

it('drops cached thumbnails older than 30 days at launch', async () => {
    require('../src/services/ThumbnailService');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockUnlink.mock.calls.map(c => c[0]).sort()).toEqual([
        '/cache/thumbnails2/old.jpg',
        '/cache/video_thumbs2/old.jpg',
    ]);
});
