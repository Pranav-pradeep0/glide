import { expect, test } from '@jest/globals';
import licences from '../src/data/licences.json';
import pkg from '../package.json';

// The licences sheet must list everything the app ships. Regenerate with
// `node scripts/gen-licences.js` when this fails.
test('every dependency is listed in the licences sheet', () => {
    const listed = new Set(licences.entries.map((e) => e.name));
    const missing = Object.keys(pkg.dependencies).filter((name) => !listed.has(name));
    expect(missing).toEqual([]);
});

test('FFmpeg carries the full LGPL text and a source link', () => {
    const ffmpeg = licences.entries.find((e) => e.name === 'FFmpeg');
    const texts = licences.texts as Record<string, string>;
    expect(texts[ffmpeg!.text]).toContain('GNU LESSER GENERAL PUBLIC LICENSE');
    expect(ffmpeg!.source).toMatch(/^https:\/\//);
});
