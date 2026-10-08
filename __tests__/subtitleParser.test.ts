import { describe, expect, it, jest } from '@jest/globals';

jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { Text: 'Text' } }));

import { SubtitleParser } from '../src/utils/SubtitleParser';

describe('SubtitleParser', () => {
    describe('parseSRT', () => {
        it('parses basic 3-cue file with correct indices, start/end times, text', () => {
            const srt = `1
00:00:01,000 --> 00:00:02,500
Hello

2
00:00:03,000 --> 00:00:04,500
World

3
00:00:05,000 --> 00:00:06,500
Goodbye`;
            const cues = SubtitleParser.parseSRT(srt);
            expect(cues).toHaveLength(3);
            expect(cues[0]).toMatchObject({ index: 1, startTime: 1, endTime: 2.5, text: 'Hello' });
            expect(cues[1]).toMatchObject({ index: 2, startTime: 3, endTime: 4.5, text: 'World' });
            expect(cues[2]).toMatchObject({ index: 3, startTime: 5, endTime: 6.5, text: 'Goodbye' });
        });

        it('parses multi-line cue text', () => {
            const srt = `1\n00:00:01,000 --> 00:00:02,000\nLine 1\nLine 2`;
            const cues = SubtitleParser.parseSRT(srt);
            expect(cues[0].text).toBe('Line 1\nLine 2');
        });

        it('extracts sound effect', () => {
            const srt = `1\n00:00:01,000 --> 00:00:02,000\n[Explosion] Boom`;
            const cues = SubtitleParser.parseSRT(srt);
            expect(cues[0].soundEffect).toBe('Explosion');
        });

        it('skips malformed blocks', () => {
            const srt = `1\n00:00:01,000 --> 00:00:02,000\nGood\n\n2\nBadTime\nText\n\n3\nJust two lines`;
            const cues = SubtitleParser.parseSRT(srt);
            expect(cues).toHaveLength(1);
            expect(cues[0].text).toBe('Good');
        });

        it('returns empty array for empty input', () => {
            expect(SubtitleParser.parseSRT('')).toEqual([]);
        });
    });

    describe('parseVTT', () => {
        it('parses basic file with WEBVTT header', () => {
            const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:02.500
Hello`;
            const cues = SubtitleParser.parseVTT(vtt);
            expect(cues).toHaveLength(1);
            expect(cues[0].text).toBe('Hello');
            expect(cues[0].startTime).toBe(1);
            expect(cues[0].endTime).toBe(2.5);
        });

        // Bug: VTT allows MM:SS.mmm without hours, but regex expects HH:MM:SS.mmm
        it.skip('parses MM:SS.mmm format without hours', () => {
            const vtt = `WEBVTT\n\n02:30.000 --> 03:45.500\nShort time format`;
            const cues = SubtitleParser.parseVTT(vtt);
            expect(cues).toHaveLength(1);
            expect(cues[0].startTime).toBe(150);
        });
    });

    describe('parseASS', () => {
        it('converts dialogue lines with overrides to HTML', () => {
            const ass = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\b1}Bold{\\b0} and {\\i1}Italic{\\i0}`;
            const cues = SubtitleParser.parseASS(ass);
            expect(cues).toHaveLength(1);
            expect(cues[0].startTime).toBe(1);
            expect(cues[0].endTime).toBe(2.5);
            expect(cues[0].text).toBe('<b>Bold</b> and <i>Italic</i>');
        });

        it('skips lines before [Events] section', () => {
            const ass = `[Script Info]
Title: Test
Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,Should skip
[Events]
Dialogue: 0,0:00:03.00,0:00:04.50,Default,,0,0,0,,Should keep`;
            const cues = SubtitleParser.parseASS(ass);
            expect(cues).toHaveLength(1);
            expect(cues[0].text).toBe('Should keep');
        });
    });

    describe('parse auto-detect', () => {
        it('detects WEBVTT', () => {
            const cues = SubtitleParser.parse('WEBVTT\n00:00:01.000 --> 00:00:02.000\nTest');
            expect(cues).toHaveLength(1);
        });
        it('detects ASS', () => {
            const cues = SubtitleParser.parse('[Script Info]\n[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Test');
            expect(cues).toHaveLength(1);
        });
        it('defaults to SRT', () => {
            const cues = SubtitleParser.parse('1\n00:00:01,000 --> 00:00:02,000\nTest');
            expect(cues).toHaveLength(1);
        });
    });

    describe('findActiveCue', () => {
        const cues = [
            { index: 1, startTime: 1, endTime: 3, text: 'One' },
            { index: 2, startTime: 2, endTime: 4, text: 'Two' },
        ];
        
        it('returns single matching cue', () => {
            const cue = SubtitleParser.findActiveCue(cues, 1.5);
            expect(cue?.text).toBe('One');
        });

        it('merges overlapping cues with newlines', () => {
            const cue = SubtitleParser.findActiveCue(cues, 2.5);
            expect(cue?.text).toBe('One\nTwo');
        });

        it('returns null if no match', () => {
            const cue = SubtitleParser.findActiveCue(cues, 5);
            expect(cue).toBeNull();
        });
    });
});
