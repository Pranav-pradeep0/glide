import { describe, expect, it } from '@jest/globals';
import { parseEmphasis } from '../src/utils/markdownEmphasis';

describe('parseEmphasis', () => {
    it('splits bold and italic out of recap text', () => {
        expect(parseEmphasis('In *Frankenstein*, **Victor** flees.')).toEqual([
            { text: 'In ' },
            { text: 'Frankenstein', italic: true },
            { text: ', ' },
            { text: 'Victor', bold: true },
            { text: ' flees.' },
        ]);
    });

    it('leaves a lone or spaced asterisk alone', () => {
        expect(parseEmphasis('5 * 3 and * not this')).toEqual([{ text: '5 * 3 and * not this' }]);
        expect(parseEmphasis('Plain text')).toEqual([{ text: 'Plain text' }]);
    });
});
