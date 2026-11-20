import { describe, expect, it } from '@jest/globals';
import { SubtitleSelectionService } from '../src/services/SubtitleSelectionService';

const track = (title: string, language: string) => ({ title, language }) as any;

describe('SubtitleSelectionService.scoreEmbeddedTracks', () => {
    const score = (t: ReturnType<typeof track>) =>
        SubtitleSelectionService.scoreEmbeddedTracks([t], 'en')[0].score;

    it('prefers the right language over SDH in another one', () => {
        expect(score(track('English', 'eng'))).toBeGreaterThan(score(track('Français SDH', 'fre')));
    });

    it('matches SDH keywords as whole words only', () => {
        expect(score(track('Accented', 'fre'))).toBe(score(track('Plain', 'fre')));
        expect(score(track('English CC', 'fre'))).toBeGreaterThan(score(track('Plain', 'fre')));
        expect(score(track('closed.caption', 'fre'))).toBeGreaterThan(score(track('Plain', 'fre')));
    });
});
