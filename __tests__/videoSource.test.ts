import { describe, expect, it } from '@jest/globals';
import { dayOf, sourceOf, withDays } from '../src/utils/videoSource';
import { VideoHistoryEntry } from '../src/types';

describe('sourceOf', () => {
    it('names a share by its share, decoded', () => {
        expect(sourceOf('smb://192.168.1.5/My%20Movies/Dune.mkv')).toMatchObject({ kind: 'network', label: 'My Movies' });
    });
    it('tells Telegram, links and local files apart', () => {
        expect(sourceOf('tg://123/456').kind).toBe('telegram');
        expect(sourceOf('https://cdn.example.com/a.m3u8').kind).toBe('link');
        expect(sourceOf('/storage/emulated/0/Movies/a.mp4').kind).toBe('device');
        expect(sourceOf('content://media/external/video/1').kind).toBe('device');
    });
    it('survives a malformed share name', () => {
        expect(sourceOf('smb://host/%E0%A4%A/a.mkv').label).toBe('%E0%A4%A');
    });
});

describe('day grouping', () => {
    const now = new Date(2026, 10, 2, 15, 0).getTime();
    const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime();

    it('buckets by calendar day, not 24-hour spans', () => {
        expect(dayOf(at(2, 0), now)).toBe('Today');
        expect(dayOf(at(1, 23), now)).toBe('Yesterday');
        expect(dayOf(new Date(2026, 9, 28, 9).getTime(), now)).toBe('This week');
        expect(dayOf(new Date(2026, 9, 26, 9).getTime(), now)).toBe('Earlier');
    });

    it('puts one heading before each day', () => {
        const entry = (t: number) => ({ videoPath: String(t), lastWatchedTime: t } as VideoHistoryEntry);
        const items = [entry(at(2, 14)), entry(at(2, 9)), entry(at(1, 20)), entry(new Date(2026, 8, 1).getTime())];
        expect(withDays(items, now).map(i => (typeof i === 'string' ? i : 'v'))).toEqual(
            ['Today', 'v', 'v', 'Yesterday', 'v', 'Earlier', 'v'],
        );
    });
});
