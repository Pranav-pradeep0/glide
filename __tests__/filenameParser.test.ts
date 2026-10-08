import { describe, expect, it } from '@jest/globals';
import { FilenameParser } from '../src/utils/FilenameParser';

describe('FilenameParser', () => {
    it('parses movie with year', () => {
        const result = FilenameParser.parse('The.Matrix.1999.1080p.BluRay.x264.mkv');
        expect(result.title).toBe('The Matrix');
        expect(result.year).toBe(1999);
        expect(result.isTVShow).toBe(false);
    });

    it('parses TV show S01E01', () => {
        const result = FilenameParser.parse('Breaking.Bad.S01E01.720p.mkv');
        expect(result.title).toBe('Breaking Bad');
        expect(result.isTVShow).toBe(true);
        expect(result.season).toBe(1);
        expect(result.episode).toBe(1);
    });

    it('parses TV show 1x01', () => {
        const result = FilenameParser.parse('Seinfeld.1x01.avi');
        expect(result.title).toBe('Seinfeld');
        expect(result.isTVShow).toBe(true);
    });

    it('removes junk brackets and preserves year', () => {
        const result = FilenameParser.parse('[YTS.MX] Inception (2010) [1080p].mp4');
        expect(result.title).toContain('Inception');
        expect(result.year).toBe(2010);
    });

    it('parses bare filename', () => {
        const result = FilenameParser.parse('my_home_video.mp4');
        expect(result.title).toBe('my home video');
        expect(result.isTVShow).toBe(false);
    });

    it('strips various extensions', () => {
        const exts = ['.mkv', '.mp4', '.avi', '.webm'];
        for (const ext of exts) {
            const result = FilenameParser.parse(`Test.Video${ext}`);
            expect(result.title).toBe('Test Video');
        }
    });

    it('removes website URLs', () => {
        const result = FilenameParser.parse('www.site.com.My.Movie.2020.mp4');
        expect(result.title).toBe('My Movie');
        expect(result.year).toBe(2020);
    });
});
