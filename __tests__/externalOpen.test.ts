import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../src/services/FileService', () => ({ FileService: {} }));
jest.mock('react-native', () => ({ Linking: {}, NativeModules: {}, Platform: { OS: 'android' } }));

import { DeepLinkService } from '../src/services/DeepLinkService';

const externalOpenFrom = DeepLinkService.externalOpenFrom.bind(DeepLinkService);

describe('externalOpenFrom', () => {
    it('pairs headers, names subtitles uniquely and marks the enabled one', () => {
        const open = externalOpenFrom({
            headers: ['User-Agent', 'Stremio', 'Cookie', 'a=b'],
            subs: ['http://h/1.srt', 'http://h/2.srt', 'http://h/3.vtt'],
            subsName: ['eng', 'eng', ''],
            subsEnable: ['http://h/2.srt'],
        });
        expect(open.headers).toEqual({ 'User-Agent': 'Stremio', Cookie: 'a=b' });
        expect(open.subtitles).toEqual([
            { uri: 'http://h/1.srt', name: 'eng', enable: false },
            { uri: 'http://h/2.srt', name: 'eng (2)', enable: true },
            { uri: 'http://h/3.vtt', name: '3.vtt', enable: false },
        ]);
        expect(open.playlist).toBeUndefined();
    });

    it('never names anything from the link under secure_uri', () => {
        const open = externalOpenFrom({
            secureUri: true,
            subs: ['http://h/secret.srt'],
            videoList: ['http://h/ep1.mkv', 'http://h/ep2.mkv'],
            videoListName: ['Episode 1'],
        });
        expect(open.subtitles?.[0].name).toBe('Subtitle 1');
        expect(open.playlist).toEqual([
            { uri: 'http://h/ep1.mkv', name: 'Episode 1' },
            { uri: 'http://h/ep2.mkv', name: 'Video 2' },
        ]);
    });

    it('ignores a one-video list and a trailing unpaired header', () => {
        const open = externalOpenFrom({ videoList: ['http://h/a.mkv'], headers: ['X-Only'] });
        expect(open.playlist).toBeUndefined();
        expect(open.headers).toEqual({});
    });
});
