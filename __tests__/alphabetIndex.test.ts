import { describe, expect, it } from '@jest/globals';
import { indexLetter, letterJumpIndex } from '../src/utils/alphabetIndex';

describe('A–Z strip', () => {
    it('files accented, lower-case and non-letter names', () => {
        expect(indexLetter('édith')).toBe('E');
        expect(indexLetter('  zebra')).toBe('Z');
        expect(indexLetter('99 Problems')).toBe('#');
        expect(indexLetter('')).toBe('#');
    });

    it('jumps by the given key to the first entry at or after the letter', () => {
        const byArtist = ['2Pac', 'ABBA', 'Coldplay', 'Édith Piaf', 'Muse'];
        const key = (s: string) => s;
        expect(letterJumpIndex(byArtist, '#', key)).toBe(0);
        expect(letterJumpIndex(byArtist, 'C', key)).toBe(2);
        expect(letterJumpIndex(byArtist, 'D', key)).toBe(3);
        expect(letterJumpIndex(byArtist, 'Z', key)).toBe(4);
        expect(letterJumpIndex([], 'A', key)).toBe(-1);
    });
});
