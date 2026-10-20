/**
 * Writes src/data/licences.json, the list the Settings licences sheet shows.
 *
 *   node scripts/gen-licences.js
 *
 * Run after adding or removing a dependency; __tests__/licences.test.ts fails until you do.
 * Each JS package's own LICENSE file is copied, because MIT and Apache ask for the exact
 * copyright notice to ship with the app. A package that ships none gets the MIT text with
 * the author from its package.json -- check that it really is MIT when one is added.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n').trim();
const pkg = require('../package.json');

const texts = {
    'Apache-2.0': read('licences/Apache-2.0.txt'),
    'LGPL-2.1': read('licences/LGPL-2.1.txt'),
    // Starts with the font's copyright line; the OFL asks for both to ship with the font.
    'OFL-1.1': read('android/app/src/main/res/raw/ofl_atkinson_hyperlegible_next.txt'),
};

const media3 = read('android/app/build.gradle').match(/androidx\.media3:media3-exoplayer:([\d.]+)/)[1];

// Native libraries: not in package.json, so listed here.
const entries = [
    {
        name: 'FFmpeg',
        license: 'LGPL-2.1-or-later',
        text: 'LGPL-2.1',
        notice:
            'Copyright (c) the FFmpeg developers. Glide uses FFmpeg 6.0 (commit b37bf81a7a97), unmodified, to decode ' +
            'AC-3, E-AC-3, DTS and TrueHD audio. It ships as separate libraries (libavcodec.so, ' +
            'libavutil.so, libswresample.so) that you may replace with your own build.',
        source: 'https://github.com/FFmpeg/FFmpeg/tree/b37bf81a7a9782438e4fe06a249329e279694494',
    },
    {
        name: 'Atkinson Hyperlegible Next',
        license: 'OFL-1.1',
        text: 'OFL-1.1',
        notice: 'Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors.',
        source: 'https://github.com/googlefonts/atkinson-hyperlegible-next',
    },
    {
        name: `AndroidX Media3 ${media3}`,
        license: 'Apache-2.0',
        text: 'Apache-2.0',
        notice: 'Copyright The Android Open Source Project.',
    },
    {
        name: `LiteRT ${read('android/app/build.gradle').match(/com\.google\.ai\.edge\.litert:litert:([\d.]+)/)[1]}`,
        license: 'Apache-2.0',
        text: 'Apache-2.0',
        notice: 'Copyright Google LLC. Runs YAMNet on the phone for haptics.',
        source: 'https://github.com/google-ai-edge/LiteRT',
    },
    {
        name: 'YAMNet',
        license: 'Apache-2.0',
        text: 'Apache-2.0',
        notice: 'Copyright The TensorFlow Authors. The sound-event model haptics use to tell music, speech and effects apart.',
        source: 'https://github.com/tensorflow/models/tree/master/research/audioset/yamnet',
    },
    {
        name: `ACRA ${read('android/app/build.gradle').match(/ch\.acra:acra-mail:([\d.]+)/)[1]}`,
        license: 'Apache-2.0',
        text: 'Apache-2.0',
        notice: 'Copyright the ACRA contributors. Offers to email a crash report after a crash.',
        source: 'https://github.com/ACRA/acra',
    },
    {
        name: 'AndroidX libraries',
        license: 'Apache-2.0',
        text: 'Apache-2.0',
        notice: 'Copyright The Android Open Source Project.',
    },
    {
        name: 'Kotlin standard library',
        license: 'Apache-2.0',
        text: 'Apache-2.0',
        notice: 'Copyright JetBrains s.r.o. and Kotlin Programming Language contributors.',
    },
];

for (const name of Object.keys(pkg.dependencies).sort()) {
    const dir = path.join(root, 'node_modules', name);
    const meta = require(path.join(dir, 'package.json'));
    const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.md|\.txt)?$/i.test(f));
    let text;
    if (file) {
        text = read(path.relative(root, path.join(dir, file)));
    } else if (meta.license === 'MIT') {
        const author = typeof meta.author === 'string' ? meta.author : meta.author?.name ?? name;
        // "Name <mail> (url)" -> "Name"
        text = read('licences/MIT.txt').replace('{holder}', author.replace(/\s*[<(].*$/, ''));
    } else {
        throw new Error(`${name}: no LICENSE file and not MIT (${meta.license}); add it by hand`);
    }
    texts[name] = text;
    entries.push({ name, license: meta.license, text: name });
}

const out = path.join(root, 'src/data/licences.json');
fs.writeFileSync(out, JSON.stringify({ entries, texts }, null, 1) + '\n');
console.log(`wrote ${entries.length} entries to ${path.relative(root, out)}`);
