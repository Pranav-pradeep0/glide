import { describe, expect, it, jest } from '@jest/globals';

// Only the renderer half of SubtitleHtmlParser needs reanimated; cue lookup does not.
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { Text: 'Text' } }));

import { chooseSecondWindow, chooseWindow, interpret, isSpeechCue, WINDOW_S } from '../src/services/SubtitleAutoSync';
import { SubtitleSyncService } from '../src/services/SubtitleSyncService';
import { SubtitleParser } from '../src/utils/SubtitleParser';
import { describeAutoSync } from '../src/hooks/video-player/useSubtitleAutoSync';
import { SubtitleCue } from '../src/types';

const cue = (startTime: number, endTime: number, text = 'Where are you going?', index = 0): SubtitleCue =>
    ({ index, startTime, endTime, text });

/** A speech cue every [every] seconds from [from] to [to]. */
const dialogue = (from: number, to: number, every = 4) =>
    Array.from({ length: Math.floor((to - from) / every) }, (_, i) => cue(from + i * every, from + i * every + 2));

describe('isSpeechCue', () => {
    it('keeps spoken lines in any script', () => {
        expect(isSpeechCue(cue(0, 2, 'I told you.'))).toBe(true);
        expect(isSpeechCue(cue(0, 2, 'तुम कहाँ जा रहे हो?'))).toBe(true);
        expect(isSpeechCue(cue(0, 2, '<i>Hello</i>'))).toBe(true);
        expect(isSpeechCue(cue(0, 2, '[door slams] Get out!'))).toBe(true);
    });

    it('drops sound descriptions, lyrics and held captions, which are on screen while nobody talks', () => {
        expect(isSpeechCue(cue(0, 2, '[door slams]'))).toBe(false);
        expect(isSpeechCue(cue(0, 2, '(PHONE RINGING)'))).toBe(false);
        expect(isSpeechCue(cue(0, 3, '♪ Hallelujah ♪'))).toBe(false);
        expect(isSpeechCue(cue(0, 2, '...'))).toBe(false);
        expect(isSpeechCue(cue(0, 30, 'LONDON, 1943'))).toBe(false);
        expect(isSpeechCue(cue(5, 5, 'Zero length'))).toBe(false);
    });
});

describe('chooseWindow', () => {
    it('picks the densest dialogue near the viewer', () => {
        // Sparse dialogue, then a dense scene from 1200 s.
        const cues = [...dialogue(0, 1200, 30), ...dialogue(1200, 1800, 3)];
        const start = chooseWindow(cues, 1000)!;
        expect(start).toBeGreaterThanOrEqual(1150);
        expect(start + WINDOW_S).toBeLessThanOrEqual(1800 + 20);
    });

    it('stays near the viewer, since an edit can change sync mid-film', () => {
        const cues = [...dialogue(0, 600, 3), ...dialogue(4000, 4600, 3)];
        expect(chooseWindow(cues, 4300)!).toBeGreaterThan(3000);
    });

    it('refuses when there is too little dialogue to align', () => {
        expect(chooseWindow(dialogue(0, 600, 60), 100)).toBeNull();
        expect(chooseWindow([], 0)).toBeNull();
    });
});

describe('chooseSecondWindow', () => {
    it('picks the densest dialogue at least 20 minutes from the first window', () => {
        // Dense at 0-600 (too close to a first window at 100), denser at 3000-3600, sparse between.
        const cues = [...dialogue(0, 600, 4), ...dialogue(600, 3000, 30), ...dialogue(3000, 3600, 3)];
        const start = chooseSecondWindow(cues, 100)!;
        expect(start).toBeGreaterThanOrEqual(2950);
        expect(start + WINDOW_S).toBeLessThanOrEqual(3600 + 20);
    });

    it('looks before the first window too', () => {
        const cues = [...dialogue(0, 600, 3), ...dialogue(4000, 4600, 3)];
        expect(chooseSecondWindow(cues, 4100)!).toBeLessThan(600);
    });

    it('returns null for a film too short or with no other dense stretch', () => {
        expect(chooseSecondWindow(dialogue(0, 1200, 3), 0)).toBeNull();
        expect(chooseSecondWindow([...dialogue(0, 600, 3), ...dialogue(600, 5000, 60)], 100)).toBeNull();
        expect(chooseSecondWindow([], 0)).toBeNull();
    });
});

describe('interpret', () => {
    const base = { delayMs: 1834, ratio: 1, peakZ: 12, runnerUp: 0.3, confident: true, drift: false, source: 'energy' as const };

    it('applies a confident plain delay, rounded to the 10 ms the panel works in', () => {
        expect(interpret(base)).toEqual({ kind: 'synced', delayMs: 1830, ratio: 1 });
    });

    it('applies a confirmed frame-rate ratio with its delay', () => {
        expect(interpret({ ...base, ratio: 25 / 23.976 })).toEqual({ kind: 'synced', delayMs: 1830, ratio: 25 / 23.976 });
    });

    it('never applies an unsure or unconfirmed drifting answer', () => {
        expect(interpret({ ...base, confident: false })).toEqual({ kind: 'unsure' });
        expect(interpret({ ...base, confident: false, drift: true, ratio: 25 / 23.976 })).toEqual({ kind: 'drift' });
        expect(interpret(null)).toEqual({ kind: 'unsure' });
    });
});

describe('describeAutoSync', () => {
    it('says a subtitle was retimed for a different frame rate, with the shift when notable', () => {
        expect(describeAutoSync({ kind: 'synced', delayMs: 50, ratio: 1.0427 })).toBe('Subtitles retimed for a different frame rate');
        expect(describeAutoSync({ kind: 'synced', delayMs: -1200, ratio: 1.0427 }))
            .toBe('Subtitles retimed for a different frame rate, moved 1.20 s earlier');
        expect(describeAutoSync({ kind: 'synced', delayMs: 1200, ratio: 1 })).toBe('Subtitles moved 1.20 s later');
        expect(describeAutoSync({ kind: 'synced', delayMs: 0, ratio: 1 })).toBe('Subtitles already in sync');
    });
});

describe('cue time and video time with a ratio', () => {
    const ratio = 25 / 23.976;
    const delayMs = 1500;

    it('shows a cue at subtitle time c at video time c * ratio + delay', () => {
        const cues = [cue(3600, 3602, 'Late in the film')];
        const shownAt = 3600 * ratio + delayMs / 1000;
        expect(SubtitleParser.findActiveCue(cues, SubtitleSyncService.cueTimeAt(shownAt + 0.1, delayMs, ratio))?.text)
            .toBe('Late in the film');
        // Without the ratio it would be minutes off by now.
        expect(SubtitleParser.findActiveCue(cues, SubtitleSyncService.cueTimeAt(shownAt + 0.1, delayMs))).toBeNull();
        expect(SubtitleSyncService.cueTimeAt(10, 0)).toBe(10);
    });

    it('Pick a line keeps the ratio: the offset puts that cue at the current time', () => {
        const picked = cue(3600, 3602);
        const offset = SubtitleSyncService.calculateOffset(picked, 3800, ratio);
        expect(picked.startTime * ratio + offset / 1000).toBeCloseTo(3800, 2);
        expect(SubtitleSyncService.calculateOffset(cue(10, 12), 12)).toBe(2000);
    });
});
