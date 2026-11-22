import { beforeEach, expect, it, jest } from '@jest/globals';

jest.mock('react-native-mmkv', () => ({
    createMMKV: () => ({ set: () => {}, getString: () => undefined, remove: () => {} }),
}));

import { useVideoHistoryStore } from '../src/store/videoHistoryStore';

const store = () => useVideoHistoryStore.getState();
const path = '/storage/emulated/0/Movies/film.mkv';
const save = (view?: { resizeMode?: 'cover'; playbackRate?: number }) =>
    store().updatePlaybackPosition(path, 'film.mkv', 60, 600, undefined, 2, 150, -300, 1, 0.4, undefined, true, 1.2, view);

beforeEach(() => store().clearAllHistory());

it('keeps each video its own delays, display mode and speed, and clears them at the defaults', () => {
    save({ resizeMode: 'cover', playbackRate: 1.5 });
    expect(store().getVideoHistory(path)).toMatchObject({
        selectedSubtitleTrackId: 2, audioDelay: 150, subtitleDelay: -300, brightness: 0.4,
        volumeLeveler: true, videoEnhancement: 1.2, resizeMode: 'cover', playbackRate: 1.5,
    });
    save();
    expect(store().getVideoHistory(path)?.resizeMode).toBeUndefined();
    expect(store().getVideoHistory(path)?.playbackRate).toBeUndefined();
});
