import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createUnplayableNotifier, UNPLAYABLE_BATCH_MS } from '../src/utils/unplayableToast';

describe('unplayable song toast', () => {
    let shown: string[];
    let active: boolean;
    let notify: ReturnType<typeof createUnplayableNotifier>;

    beforeEach(() => {
        jest.useFakeTimers();
        shown = [];
        active = true;
        notify = createUnplayableNotifier(t => shown.push(t), () => active);
    });
    afterEach(() => { jest.useRealTimers(); });

    it('names one skipped song', () => {
        notify({ title: 'Bad Song', skipped: true, allFailed: false });
        expect(shown).toEqual([]);
        jest.advanceTimersByTime(UNPLAYABLE_BATCH_MS);
        expect(shown).toEqual(["Can't play Bad Song, skipped"]);
    });

    it('says once when the whole queue fails', () => {
        notify({ title: 'A', skipped: true, allFailed: false });
        notify({ title: 'B', skipped: true, allFailed: false });
        notify({ title: 'C', skipped: false, allFailed: true });
        jest.runAllTimers();
        expect(shown).toEqual(['Nothing in this queue can play']);
    });

    it('counts a run of skips', () => {
        notify({ title: 'A', skipped: true, allFailed: false });
        notify({ title: 'B', skipped: true, allFailed: false });
        jest.runAllTimers();
        expect(shown).toEqual(["Skipped 2 songs that can't play"]);
    });

    it('reports a lone song that stops, with a long title clipped', () => {
        notify({ title: 'x'.repeat(80), skipped: false, allFailed: false });
        expect(shown).toHaveLength(1);
        expect(shown[0]).toMatch(/^Can't play x+…$/);
        expect(shown[0].length).toBeLessThan(60);
    });

    it('drops everything while backgrounded', () => {
        notify({ title: 'A', skipped: true, allFailed: false });
        active = false;
        jest.runAllTimers();
        notify({ title: 'B', skipped: false, allFailed: false });
        active = true;
        jest.runAllTimers();
        expect(shown).toEqual([]);
    });
});
