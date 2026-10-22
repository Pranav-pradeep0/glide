import { describe, expect, it } from '@jest/globals';
import { tvSeekTarget } from '../src/hooks/video-player/useTvRemote';

describe('tvSeekTarget', () => {
    it('moves 10 s a press, either way, inside the video', () => {
        expect(tvSeekTarget(100, 1, 0, 600)).toBe(110);
        expect(tvSeekTarget(100, -1, 0, 600)).toBe(90);
        expect(tvSeekTarget(5, -1, 0, 600)).toBe(0);
        expect(tvSeekTarget(595, 1, 0, 600)).toBe(600);
    });

    it('speeds up while held, up to 15 s a repeat', () => {
        const early = tvSeekTarget(0, 1, 1, 600);
        const later = tvSeekTarget(0, 1, 50, 600);
        expect(early).toBeLessThan(later);
        expect(tvSeekTarget(0, 1, 1000, 600)).toBe(15);
    });
});
