import { describe, expect, it } from '@jest/globals';
import { carriedSubtitle, matchCarriedTrack } from '../src/hooks/video-player/types';

// Next / Previous carry a track choice into another file, where ids and indexes differ.

describe('matchCarriedTrack', () => {
    const tracks = [
        { language: 'eng', title: 'English' },
        { language: 'hin', title: 'Hindi' },
        { language: 'eng', title: 'English SDH' },
    ];

    it('finds the same language at a different position', () => {
        expect(matchCarriedTrack(tracks, { language: 'hin', ordinal: 0 })).toBe(1);
    });

    it('prefers the same title among tracks of one language', () => {
        expect(matchCarriedTrack(tracks, { language: 'eng', title: 'English SDH', ordinal: 0 })).toBe(2);
        expect(matchCarriedTrack(tracks, { language: 'ENG', title: 'Renamed', ordinal: 2 })).toBe(0);
    });

    it('does not fall back to position when the language is missing', () => {
        expect(matchCarriedTrack(tracks, { language: 'fre', ordinal: 1 })).toBe(-1);
    });

    it('uses position for untagged tracks', () => {
        const untagged = [{ language: 'und' }, {}];
        expect(matchCarriedTrack(untagged, { language: 'und', ordinal: 1 })).toBe(1);
        expect(matchCarriedTrack(untagged, { ordinal: 5 })).toBe(-1);
    });

    it('does not carry an untagged position into tagged tracks', () => {
        expect(matchCarriedTrack(tracks, { language: 'und', ordinal: 0 })).toBe(-1);
    });
});

describe('carriedSubtitle', () => {
    const tracks = [{ index: 3, codec: 'subrip', language: 'eng', title: 'English' }];

    it('carries Off as null and an external file as no opinion', () => {
        expect(carriedSubtitle(tracks, null)).toBeNull();
        expect(carriedSubtitle(tracks, -999)).toBeUndefined();
    });

    it('carries an embedded track by language, title and position', () => {
        expect(carriedSubtitle(tracks, 3)).toEqual({ language: 'eng', title: 'English', ordinal: 0 });
    });
});
