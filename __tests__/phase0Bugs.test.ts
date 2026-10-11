import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('react-native-mmkv', () => {
    const store = new Map<string, string>();
    return {
        createMMKV: () => ({
            set: (k: string, v: string) => store.set(k, v),
            getString: (k: string) => store.get(k),
        }),
    };
});

import { useVideoHistoryStore } from '../src/store/videoHistoryStore';
import { sortVideosByName } from '../src/hooks/useMediaService';
import type { VideoFile } from '../src/types';

describe('Phase 0 Bug Fixes', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        useVideoHistoryStore.setState({ history: new Map(), isHydrated: true });
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    describe('Queue natural sort', () => {
        it('sorts episode names naturally instead of lexicographically', () => {
            const queue = [
                { name: 'Episode 10.mkv', path: '/path/Episode 10.mkv' },
                { name: 'Episode 1.mkv', path: '/path/Episode 1.mkv' },
                { name: 'Episode 2.mkv', path: '/path/Episode 2.mkv' },
                { name: 'Episode 20.mkv', path: '/path/Episode 20.mkv' },
            ] as VideoFile[];

            expect(sortVideosByName(queue).map(v => v.name)).toEqual([
                'Episode 1.mkv',
                'Episode 2.mkv',
                'Episode 10.mkv',
                'Episode 20.mkv',
            ]);
        });

        it('orders by season and episode when every file has one', () => {
            const names = ['Show.S02E01.mkv', 'Show.2019.S01E02.mkv', 'Show.S01E10.mkv', 'Show.S01E01.mkv'];
            const queue = names.map(name => ({ name })) as VideoFile[];
            expect(sortVideosByName(queue).map(v => v.name)).toEqual([
                'Show.S01E01.mkv', 'Show.2019.S01E02.mkv', 'Show.S01E10.mkv', 'Show.S02E01.mkv',
            ]);
            // One file without an episode number: plain name order for the whole folder.
            const mixed = [...queue, { name: 'Extras.mkv' }] as VideoFile[];
            expect(sortVideosByName(mixed)[0].name).toBe('Extras.mkv');
        });

        it('leaves the array it was given alone', () => {
            const queue = [{ name: 'b.mkv' }, { name: 'a.mkv' }] as VideoFile[];
            sortVideosByName(queue);
            expect(queue.map(v => v.name)).toEqual(['b.mkv', 'a.mkv']);
        });
    });

    describe('Video history path separation', () => {
        it('keeps separate history for two files named Episode 1.mkv in different folders', () => {
            const store = useVideoHistoryStore.getState();

            const pathA = '/shows/ShowA/Episode 1.mkv';
            const pathB = '/shows/ShowB/Episode 1.mkv';

            store.updatePlaybackPosition(pathA, 'Episode 1.mkv', 120, 1800);
            store.updatePlaybackPosition(pathB, 'Episode 1.mkv', 600, 2400);

            const historyA = store.getVideoHistory(pathA);
            const historyB = store.getVideoHistory(pathB);

            expect(historyA).not.toBeNull();
            expect(historyB).not.toBeNull();
            expect(historyA?.videoPath).toBe(pathA);
            expect(historyB?.videoPath).toBe(pathB);
            expect(historyA?.lastPausedPosition).toBe(120);
            expect(historyB?.lastPausedPosition).toBe(600);
            expect(historyA?.duration).toBe(1800);
            expect(historyB?.duration).toBe(2400);
        });
    });
});
