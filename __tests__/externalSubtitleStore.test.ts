import { describe, expect, it, jest } from '@jest/globals';

const mockFiles = new Map<string, string>();

jest.mock('@dr.pogodin/react-native-fs', () => ({
    DocumentDirectoryPath: '/docs',
    mkdir: async () => {},
    exists: async () => true,
    writeFile: async (p: string, s: string) => { mockFiles.set(p, s); },
    readFile: async (p: string) => {
        if (!mockFiles.has(p)) {throw new Error('ENOENT');}
        return mockFiles.get(p);
    },
    readDir: async () => [...mockFiles.keys()].map(p => ({ path: p, name: p.split('/').pop() })),
    unlink: async (p: string) => { mockFiles.delete(p); },
}));

const mockHistory = new Map<string, { videoPath: string; selectedSubtitleTrackId?: number }>();
jest.mock('../src/store/videoHistoryStore', () => ({
    useVideoHistoryStore: { getState: () => ({ history: mockHistory }) },
}));

const cue = { start: 1, end: 2, text: 'Hi' };

describe('ExternalSubtitleStore', () => {
    it('brings back the saved subtitle for that video only', async () => {
        const { saveExternalSubtitle, loadExternalSubtitle } = require('../src/services/ExternalSubtitleStore');
        await saveExternalSubtitle({ videoPath: '/a.mkv', name: 'a.srt', isSDH: true, cues: [cue] });

        expect(await loadExternalSubtitle('/a.mkv')).toEqual({ videoPath: '/a.mkv', name: 'a.srt', isSDH: true, cues: [cue] });
        expect(await loadExternalSubtitle('/b.mkv')).toBeNull();
    });

    it('sweeps files whose history entry no longer says "external"', async () => {
        mockFiles.clear();
        mockHistory.clear();
        let store: any;
        jest.isolateModules(() => { store = require('../src/services/ExternalSubtitleStore'); });
        await store.saveExternalSubtitle({ videoPath: '/kept.mkv', name: 'k', isSDH: false, cues: [cue] });
        await store.saveExternalSubtitle({ videoPath: '/gone.mkv', name: 'g', isSDH: false, cues: [cue] });
        mockHistory.set('k', { videoPath: '/kept.mkv', selectedSubtitleTrackId: store.EXTERNAL_SUBTITLE_INDEX });
        mockHistory.set('g', { videoPath: '/gone.mkv', selectedSubtitleTrackId: 2 });

        jest.isolateModules(() => { store = require('../src/services/ExternalSubtitleStore'); });
        await new Promise(r => setTimeout(r, 0));

        expect(await store.loadExternalSubtitle('/kept.mkv')).not.toBeNull();
        expect(await store.loadExternalSubtitle('/gone.mkv')).toBeNull();
    });
});
