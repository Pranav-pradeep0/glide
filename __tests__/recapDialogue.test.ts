import { describe, expect, it, jest } from '@jest/globals';
import { RecapService } from '../src/services/RecapService';

jest.mock('../src/utils/constants', () => ({ AI_PROXY_URL: '', RECAP_AVAILABLE: false }));
jest.mock('../src/services/SubtitleCueStore', () => ({ SubtitleCueStore: {} }));

const cue = (startTime: number, text: string) => ({ index: 0, startTime, endTime: startTime + 2, text });

describe('RecapService.cleanCue', () => {
    it('keeps speaker labels and splits dashed turns', () => {
        expect(RecapService.cleanCue('- Are you ill? - [Harlander] Thank you.'))
            .toEqual(['Are you ill?', 'Harlander: Thank you.']);
    });

    it('drops sound labels, including ones that name a character', () => {
        expect(RecapService.cleanCue('[Victor grunting]')).toEqual([]);
        expect(RecapService.cleanCue('[MUSIC] (SIGHS) <i>It is finished.</i>')).toEqual(['It is finished.']);
    });
});

describe('RecapService.getDialogueForRecap', () => {
    it('reaches back past a quiet stretch and marks the scene change', async () => {
        const cues = [
            cue(100, 'Where is the boat?'),
            cue(103, '[Anna] At the dock.'),
            cue(110, 'Then we go tonight.'),
            cue(115, 'Bring the money, all of it, and do not tell your brother or anyone at the harbour where we are going or when we will be back.'),
            // Ten quiet minutes of sound labels only: a fixed 5-minute window saw nothing.
            ...Array.from({ length: 20 }, (_, i) => cue(200 + i * 30, '[thunder rumbles]')),
            cue(800, 'The storm is here.'),
            cue(803, '- It is. - [Anna] Run!'),
        ];
        const dialogue = await RecapService.getDialogueForRecap('v.mkv', [], cues, 805);
        expect(dialogue).toBe([
            'Where is the boat?', 'Anna: At the dock.', 'Then we go tonight.',
            'Bring the money, all of it, and do not tell your brother or anyone at the harbour where we are going or when we will be back.',
            '',
            'The storm is here.', 'It is.', 'Anna: Run!',
        ].join('\n'));
    });
});
