import { describe, expect, it } from '@jest/globals';
import { cutoutInset } from '../src/utils/cutoutInset';

// A 900 x 400 dp phone in landscape.
const W = 900;
const punchHole = [{ left: 10, top: 180, right: 40, bottom: 220 }];

describe('cutoutInset', () => {
    it('moves only the control level with a punch hole', () => {
        expect(cutoutInset('left', 40, punchHole, W, 176, 224)).toBe(40); // lock, centred
        expect(cutoutInset('left', 40, punchHole, W, 0, 56)).toBe(0); // top bar
        expect(cutoutInset('left', 40, punchHole, W, 270, 400)).toBe(0); // seek bar
    });

    it('ignores a cutout on the other edge', () => {
        expect(cutoutInset('right', 0, punchHole, W, 176, 224)).toBe(0);
        const flipped = [{ left: 860, top: 180, right: 890, bottom: 220 }];
        expect(cutoutInset('right', 40, flipped, W, 176, 224)).toBe(40);
        expect(cutoutInset('left', 0, flipped, W, 176, 224)).toBe(0);
    });

    it('moves everything for a notch as tall as the edge', () => {
        expect(cutoutInset('left', 30, [{ left: 0, top: 0, right: 30, bottom: 400 }], W, 0, 56)).toBe(30);
    });

    it('keeps the full inset for a side navigation bar or unknown rects', () => {
        expect(cutoutInset('left', 48, punchHole, W, 0, 56)).toBe(48);
        expect(cutoutInset('left', 40, null, W, 0, 56)).toBe(40);
    });
});
