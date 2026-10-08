import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../src/services/FileService', () => ({ FileService: {} }));

const mockGetMimeType = jest.fn<(uri: string) => Promise<string | null>>();

jest.mock('react-native', () => ({
    Linking: { getInitialURL: jest.fn(), addEventListener: jest.fn() },
    NativeModules: { MediaStoreAudioModule: { getMimeType: (uri: string) => mockGetMimeType(uri) } },
    Platform: { OS: 'android' },
}));

import { DeepLinkService } from '../src/services/DeepLinkService';

// MainActivity is exported: any app can hand it any URI. Only local audio may play.
describe('DeepLinkService.isOpenableAudioUri', () => {
    it('accepts local content and file URIs', () => {
        expect(DeepLinkService.isOpenableAudioUri('content://media/external/audio/media/42')).toBe(true);
        expect(DeepLinkService.isOpenableAudioUri('file:///storage/emulated/0/Music/song.mp3')).toBe(true);
    });

    it('rejects remote, unknown and malformed URIs', () => {
        expect(DeepLinkService.isOpenableAudioUri('https://example.com/song.mp3')).toBe(false);
        expect(DeepLinkService.isOpenableAudioUri('smb://server/share/song.mp3')).toBe(false);
        expect(DeepLinkService.isOpenableAudioUri('content://')).toBe(false);
        expect(DeepLinkService.isOpenableAudioUri('content://a b')).toBe(false);
    });

    it('rejects video URIs even if content or file scheme', () => {
        expect(DeepLinkService.isOpenableAudioUri('content://media/external/video/media/42')).toBe(false);
        expect(DeepLinkService.isOpenableAudioUri('file:///storage/emulated/0/Movies/movie.mp4')).toBe(false);
        expect(DeepLinkService.isOpenableAudioUri('file:///storage/emulated/0/Movies/episode.mkv')).toBe(false);
    });

    it('rejects oversized URIs', () => {
        expect(DeepLinkService.isOpenableAudioUri(`content://x/${'a'.repeat(8200)}`)).toBe(false);
    });

    // An extension is only an extension at the end of the file name. Matching it anywhere
    // in the URI let an authority or a folder decide what kind of file this is.
    it('reads the extension from the file name, not the whole URI', () => {
        expect(DeepLinkService.isOpenableAudioUri('content://com.foo.tsprovider/doc/song.mp3')).toBe(true);
        expect(DeepLinkService.isOpenableAudioUri('file:///storage/emulated/0/.movies/song.flac')).toBe(true);
        expect(DeepLinkService.isOpenableAudioUri('file:///storage/emulated/0/Music/the.mid.day.mix.mp3')).toBe(true);
        expect(DeepLinkService.isOpenableAudioUri('file:///storage/emulated/0/Music/song.mp3.mkv')).toBe(false);
    });

    // Downloads and many document providers hand over a URI with no name at all; the MIME
    // check behind this one is what settles those.
    it('lets extensionless content URIs through to the MIME check', () => {
        expect(DeepLinkService.isOpenableAudioUri('content://com.android.providers.downloads.documents/document/1234')).toBe(true);
        expect(DeepLinkService.isOpenableAudioUri('file:///storage/emulated/0/Download/1234')).toBe(false);
    });
});

// What the shape check cannot name, the system does. This is what keeps a video opened
// into VideoPlayerActivity out of the music player: the url event reaches both.
describe('DeepLinkService.isAudioContent', () => {
    const uri = 'content://com.android.providers.media.documents/document/video%3A123';

    it('believes the provider over the URI', async () => {
        mockGetMimeType.mockResolvedValue('video/mp4');
        await expect(DeepLinkService.isAudioContent(uri)).resolves.toBe(false);

        mockGetMimeType.mockResolvedValue('audio/flac');
        await expect(DeepLinkService.isAudioContent(uri)).resolves.toBe(true);
    });

    it('keeps playing when the provider will not say', async () => {
        mockGetMimeType.mockResolvedValue(null);
        await expect(DeepLinkService.isAudioContent(uri)).resolves.toBe(true);

        mockGetMimeType.mockRejectedValue(new Error('no such provider'));
        await expect(DeepLinkService.isAudioContent(uri)).resolves.toBe(true);
    });

    it('trusts an audio extension without asking', async () => {
        mockGetMimeType.mockResolvedValue('video/mp4');
        await expect(DeepLinkService.isAudioContent('file:///music/song.mp3')).resolves.toBe(true);
    });
});

describe('DeepLinkService.isVideoUri', () => {
    it('separates video from audio by file name', () => {
        expect(DeepLinkService.isVideoUri('content://com.foo.bar/doc/film.mkv')).toBe(true);
        expect(DeepLinkService.isVideoUri('content://com.foo.bar/doc/song.mp3')).toBe(false);
        expect(DeepLinkService.isVideoUri('https://example.com/live/stream.m3u8')).toBe(true);
    });

    it('falls back to the MediaStore path when there is no extension', () => {
        expect(DeepLinkService.isVideoUri('content://media/external/video/media/42')).toBe(true);
        expect(DeepLinkService.isVideoUri('content://media/external/audio/media/42')).toBe(false);
    });
});
