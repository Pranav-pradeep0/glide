import { describe, expect, it, jest } from '@jest/globals';
jest.mock('../src/services/OMDBService', () => ({
    OMDBService: { search: jest.fn(async () => null), fuzzySearch: jest.fn(async () => []) },
}));
jest.mock('@dr.pogodin/react-native-fs', () => ({}));
import { ContentDetector } from '../src/services/ContentDetector';
import { DeepLinkService } from '../src/services/DeepLinkService';
import { OMDBService } from '../src/services/OMDBService';

describe('ContentDetector.classify', () => {
    // y=2026 on "The Boys" finds a different show: OMDB matches a series by its first year.
    it('looks a series up by type, without the season year', async () => {
        await ContentDetector.classify('The Boys (2026) S05E06 2160p WEBRip.mkv', true);
        expect(OMDBService.search).toHaveBeenCalledWith('The Boys', undefined, 'series');
    });
});

describe('ContentDetector.classifySync', () => {
    it('treats a "Title (Year, Full HD)" file as a movie', () => {
        const path = '/storage/emulated/0/Download/Videos/Tarzan X Shame of Jane (1994, Full HD) movie online.mp4';
        expect(ContentDetector.classifySync(path).contentType).toBe('movie');
    });

    it('ignores folders, so camera files still read as home video', () => {
        expect(ContentDetector.classifySync('/storage/emulated/0/DCIM/Camera/VID_20241205_143022.mp4').contentType).toBe('home_video');
    });
});

describe('DeepLinkService.getVideoNameFromUri', () => {
    it('drops the folder from a document URI', () => {
        const uri = 'content://com.android.externalstorage.documents/document/primary%3AThe%20Boys%20S05%2FThe%20Boys%20(2026)%20S05E06%20%5BPMZ%5D.mkv';
        expect(DeepLinkService.getVideoNameFromUri(uri)).toBe('The Boys (2026) S05E06 [PMZ].mkv');
    });
});
