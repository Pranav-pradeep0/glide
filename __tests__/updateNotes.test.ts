import { describe, expect, it, jest } from '@jest/globals';

// The component reaches the theme store, which reaches MMKV; the parser under test does
// not care about any of it.
const mockStore = new Map<string, string>();
jest.mock('react-native-mmkv', () => ({
    createMMKV: () => ({
        set: (k: string, v: string) => mockStore.set(k, v),
        getString: (k: string) => mockStore.get(k),
        remove: (k: string) => mockStore.delete(k),
    }),
}));

import { formatNotes, parseNotes } from '../src/components/UpdateNotes';

// The release workflow writes these notes from commit subjects, so the shapes below are
// the whole of the Markdown that ever reaches the update modal.

describe('update notes', () => {
    it('reads the headings and bullets the release workflow writes', () => {
        const notes = formatNotes('### Features\n- add a thing\n- add another\n\n### Fixes\n- fix a thing');

        expect(parseNotes(notes)).toEqual([
            { kind: 'heading', text: 'Features' },
            { kind: 'bullet', text: 'add a thing' },
            { kind: 'bullet', text: 'add another' },
            { kind: 'heading', text: 'Fixes' },
            { kind: 'bullet', text: 'fix a thing' },
        ]);
    });

    it('drops emphasis and link syntax rather than showing the markers', () => {
        expect(parseNotes('- **bold** and `code` and [a link](https://example.com)')).toEqual([
            { kind: 'bullet', text: 'bold and code and a link' },
        ]);
    });

    it('cuts the build-info footer the workflow appends', () => {
        const notes = formatNotes('- a change\n\n---\n**Build Info**\n- Version: `2.2.0`');
        expect(parseNotes(notes)).toEqual([{ kind: 'bullet', text: 'a change' }]);
    });

    it('splits a body whose newlines arrive as literal backslash sequences', () => {
        const notes = formatNotes('### Fixes\\n- a fix\\r\\n- another\\n\\n---\\n**Build Info**');
        expect(parseNotes(notes)).toEqual([
            { kind: 'heading', text: 'Fixes' },
            { kind: 'bullet', text: 'a fix' },
            { kind: 'bullet', text: 'another' },
        ]);
    });

    it('says so when there is nothing to show', () => {
        expect(parseNotes(formatNotes(null))).toEqual([
            { kind: 'text', text: 'No changelog provided.' },
        ]);
    });
});
