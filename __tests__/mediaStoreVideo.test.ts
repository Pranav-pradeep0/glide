import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NativeModules, Platform } from 'react-native';

Object.defineProperty(Platform, 'OS', {
    get: () => 'android',
    configurable: true,
});

const sampleVideos = [
    {
        id: '1',
        name: 'video1.mp4',
        path: '/storage/emulated/0/DCIM/Camera/video1.mp4',
        uri: 'content://media/external/video/media/1',
        size: 1048576,
        modifiedDate: 1700000000000,
        duration: 120.5,
        width: 1920,
        height: 1080,
        isDirectory: false,
        album: 'Camera',
        bucketId: '100',
    },
    {
        id: '2',
        name: 'video2.mp4',
        path: '/storage/emulated/0/Movies/video2.mp4',
        uri: 'content://media/external/video/media/2',
        size: 2097152,
        modifiedDate: 1700001000000,
        duration: 3600.0,
        width: 3840,
        height: 2160,
        isDirectory: false,
        album: 'Movies',
        bucketId: '200',
    },
];

const sampleFolders = [
    {
        id: '100',
        title: 'Camera',
        count: 1,
        newestTimestamp: 1700000000000,
        firstVideoUri: 'content://media/external/video/media/1',
        firstVideoPath: '/storage/emulated/0/DCIM/Camera/video1.mp4',
    },
    {
        id: '200',
        title: 'Movies',
        count: 1,
        newestTimestamp: 1700001000000,
        firstVideoUri: 'content://media/external/video/media/2',
        firstVideoPath: '/storage/emulated/0/Movies/video2.mp4',
    },
];

NativeModules.MediaStoreVideoModule = {
    getLibrary: jest.fn<any>().mockResolvedValue({
        videos: sampleVideos,
        folders: sampleFolders,
    }),
    getVideos: jest.fn<any>().mockResolvedValue([sampleVideos[0]]),
    getThumbnail: jest.fn<any>().mockResolvedValue('file:///cache/video_thumbs/1_512x512.jpg'),
    getThumbnailWithSize: jest.fn<any>().mockResolvedValue('file:///cache/video_thumbs/1_320x180.jpg'),
};

jest.mock('../src/services/PermissionService', () => ({
    PermissionService: {
        check: jest.fn<any>().mockResolvedValue('granted'),
    },
}));

import { MediaService } from '../src/services/MediaService';

describe('MediaService with MediaStoreVideoModule', () => {
    beforeEach(() => {
        MediaService.invalidateCache();
        jest.clearAllMocks();
    });

    it('loads entire library in a single native pass', async () => {
        const library = await MediaService.getLibrary();
        expect(NativeModules.MediaStoreVideoModule.getLibrary).toHaveBeenCalledTimes(1);
        expect(library.videos).toHaveLength(2);
        expect(library.folders).toHaveLength(2);
        expect(library.folders[0].title).toBe('Camera');
        expect(library.folders[0].firstVideoPath).toBe('/storage/emulated/0/DCIM/Camera/video1.mp4');

        // Subsequent call uses cache
        const cached = await MediaService.getLibrary();
        expect(NativeModules.MediaStoreVideoModule.getLibrary).toHaveBeenCalledTimes(1);
        expect(cached).toBe(library);
    });

    it('returns pre-aggregated folders with counts and cover video paths', async () => {
        const folders = await MediaService.getFolders();
        expect(folders).toHaveLength(2);
        expect(folders[0].count).toBe(1);
        expect(folders[1].title).toBe('Movies');
        expect(folders[1].firstVideoUri).toBe('content://media/external/video/media/2');
    });

    it('returns videos filtered by album', async () => {
        const videos = await MediaService.getVideosByAlbum('Camera');
        expect(videos).toHaveLength(1);
        expect(videos[0].name).toBe('video1.mp4');
    });

    it('provides paginated results compatible with legacy format', async () => {
        const page = await MediaService.getVideos(null, 1);
        expect(page.edges).toHaveLength(1);
        expect(page.edges[0].name).toBe('video1.mp4');
        expect(page.page_info.has_next_page).toBe(true);
        expect(page.page_info.end_cursor).toBe('1');

        const page2 = await MediaService.getVideos(null, 1, '1');
        expect(page2.edges).toHaveLength(1);
        expect(page2.edges[0].name).toBe('video2.mp4');
        expect(page2.page_info.has_next_page).toBe(false);
    });

    it('fetches system thumbnail via MediaStoreVideoModule', async () => {
        const thumb = await MediaService.getThumbnail('content://media/external/video/media/1');
        expect(thumb).toBe('file:///cache/video_thumbs/1_512x512.jpg');
    });

    it('fetches sized system thumbnail via MediaStoreVideoModule', async () => {
        const thumb = await MediaService.getThumbnail('content://media/external/video/media/1', 320, 180);
        expect(thumb).toBe('file:///cache/video_thumbs/1_320x180.jpg');
    });
});
