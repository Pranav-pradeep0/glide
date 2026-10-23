import { describe, expect, it, jest } from '@jest/globals';
import { stepValue } from '../src/components/ui/TvStepper';

// Only the pure helper is under test; the kit pulls in native modules.
jest.mock('@/components/ui', () => ({}));

describe('stepValue', () => {
    it('steps on the grid from min and clamps at the ends', () => {
        expect(stepValue(20, 1, 12, 40, 2)).toBe(22);
        expect(stepValue(20, -1, 12, 40, 2)).toBe(18);
        expect(stepValue(40, 1, 12, 40, 2)).toBe(40);
        expect(stepValue(12, -1, 12, 40, 2)).toBe(12);
    });

    it('moves an off-grid value to its neighbour in that direction', () => {
        expect(stepValue(17.3, 1, 12, 40, 2)).toBe(18);
        expect(stepValue(17.3, -1, 12, 40, 2)).toBe(16);
    });

    it('keeps decimal steps exact', () => {
        expect(stepValue(0.2, 1, 0, 1, 0.1)).toBe(0.3);
        expect(stepValue(1, -1, 0.25, 4, 0.25)).toBe(0.75);
        expect(stepValue(0.5, 1, 0.5, 6, 0.5)).toBe(1);
    });
});
