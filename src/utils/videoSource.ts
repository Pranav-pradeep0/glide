// src/utils/videoSource.ts
//
// Where a watched video lives and which day it was watched: what Home and Recents label and group by.
import type { IconName } from '@/components/ui';
import type { VideoHistoryEntry } from '@/types';

export type SourceKind = 'device' | 'network' | 'telegram' | 'link';

/** Where a video plays from, from its path alone: a share (named by its share), Telegram, a link, or local. */
export function sourceOf(path: string): { kind: SourceKind; label: string; icon: IconName } {
    if (path.startsWith('tg://')) {return { kind: 'telegram', label: 'Telegram', icon: 'send' };}
    if (path.startsWith('smb://')) {
        const share = path.slice('smb://'.length).split('/')[1];
        let label = share || 'Network';
        try { label = decodeURIComponent(label); } catch { /* shown as stored */ }
        return { kind: 'network', label, icon: 'server' };
    }
    if (/^https?:/i.test(path)) {return { kind: 'link', label: 'Link', icon: 'link' };}
    return { kind: 'device', label: 'Local', icon: 'hard-drive' };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Today", "Yesterday", "This week" or "Earlier" for a time in ms. */
export function dayOf(time: number, now = Date.now()): string {
    const today = new Date(now).setHours(0, 0, 0, 0);
    if (time >= today) {return 'Today';}
    if (time >= today - DAY_MS) {return 'Yesterday';}
    if (time >= today - 6 * DAY_MS) {return 'This week';}
    return 'Earlier';
}

/** A day heading (a string) before each day's videos; `items` newest first. */
export function withDays(items: VideoHistoryEntry[], now = Date.now()): (VideoHistoryEntry | string)[] {
    const out: (VideoHistoryEntry | string)[] = [];
    let last = '';
    for (const item of items) {
        const day = dayOf(item.lastWatchedTime, now);
        if (day !== last) { out.push(day); last = day; }
        out.push(item);
    }
    return out;
}
