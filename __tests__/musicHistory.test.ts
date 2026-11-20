import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockMMKVStore = new Map<string, string>();

jest.mock('react-native-mmkv', () => ({
    createMMKV: () => ({
        set: (k: string, v: string) => mockMMKVStore.set(k, v),
        getString: (k: string) => mockMMKVStore.get(k),
    }),
}));

import { useMusicHistoryStore } from '../src/store/musicHistoryStore';

const ids = () => useMusicHistoryStore.getState().entries.map((e) => e.id);

describe('music history', () => {
    beforeEach(() => {
        useMusicHistoryStore.setState({ entries: [] });
    });

    it('lists the newest play first and keeps each song once', () => {
        const { recordPlay } = useMusicHistoryStore.getState();
        recordPlay('a');
        recordPlay('b');
        recordPlay('a');
        expect(ids()).toEqual(['a', 'b']);
    });

    it('keeps only the 50 most recent songs', () => {
        const { recordPlay } = useMusicHistoryStore.getState();
        for (let i = 0; i < 60; i++) recordPlay(String(i));
        expect(ids()).toHaveLength(50);
        expect(ids()[0]).toBe('59');
        expect(ids()).not.toContain('9');
    });

    it('keeps a copy of history that will not parse before it is overwritten', () => {
        mockMMKVStore.set('@glide_music_history', '[{"id":"a"');
        jest.isolateModules(() => {
            const { useMusicHistoryStore: fresh } = require('../src/store/musicHistoryStore');
            expect(fresh.getState().entries).toEqual([]);
            fresh.getState().recordPlay('b');
        });
        expect(mockMMKVStore.get('@glide_music_history.corrupt')).toBe('[{"id":"a"');
    });
});
