#!/usr/bin/env node
// The in-app SMB speed test's results, from logcat (docs/network-shares.md, step (a) go/no-go).
// Run the test from a folder's speed-test button, then: node scripts/smb-bench.js [adb serial]
// Pass: "8 x 1 MB" at 12 MB/s or more on the Mi TV.
const { execFileSync } = require('child_process');

const serial = process.argv[2] ? ['-s', process.argv[2]] : [];
const log = execFileSync('adb', [...serial, 'logcat', '-d', '-s', 'GlideSmb:W'], { encoding: 'utf8', maxBuffer: 16 << 20 });
const lines = log.split('\n').filter(l => l.includes('smb-bench')).map(l => l.slice(l.indexOf('smb-bench') + 10).trim());
if (!lines.length) {
    console.log('No speed test in the log yet.');
    process.exit(1);
}
lines.forEach(l => console.log(l));
const best = lines.map(l => /^8 x 1 MB: ([\d.]+)/.exec(l)).filter(Boolean).pop();
if (best) console.log(Number(best[1]) >= 12 ? 'GO: >= 12 MB/s' : 'NO-GO: under 12 MB/s');
