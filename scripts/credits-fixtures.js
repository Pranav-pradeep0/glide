#!/usr/bin/env node
// Real-film fixtures for the credits detector (CreditsFilmTest). For each video on the phone it
// keeps the keyframes of the last 20 minutes as 8-bit grey frames fitted into 320x180 -- what
// MediaMetadataRetriever hands CreditsAnalysis -- plus the file's own "credits" chapter, if any,
// as the truth. Only the file's header and tail are read, so a 9 GB film takes about a minute.
//
//   node scripts/credits-fixtures.js <device path>...    -> .credits-fixtures/<name>.gray + .tsv
//
// .tsv lines: size <w> <h> | duration <ms> | truth <ms> | frame <ms>   (one frame line per frame)

const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const OUT = path.join(__dirname, '..', '.credits-fixtures');
const TAIL_S = 20 * 60;
const HEAD_BYTES = 8_000_000;
// Same words as CreditsDetector.CHAPTER_WORDS.
const CREDITS = /\b(end ?credits|credits|ending|outro|ed)\b/i;

const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

function probe(file) {
  const head = path.join(OUT, '.head.mkv');
  fs.writeFileSync(head, execSync(`adb exec-out "head -c ${HEAD_BYTES} ${q(file)}"`, { maxBuffer: 2 * HEAD_BYTES }));
  const info = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_format', '-show_chapters', '-of', 'json', head]).stdout);
  fs.unlinkSync(head);
  const truth = (info.chapters || []).filter((c) => CREDITS.test(c.tags?.title || '')).map((c) => Number(c.start_time))[0];
  return { durationS: Number(info.format.duration), truthS: truth };
}

function extract(file) {
  const name = path.basename(file).replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
  const size = Number(execSync(`adb shell "stat -c %s ${q(file)}"`).toString().trim());
  const { durationS, truthS } = probe(file);
  const fromS = Math.max(0, durationS - TAIL_S);
  const offset = Math.max(HEAD_BYTES, Math.floor(size * (fromS / durationS)) - 20_000_000);
  const gray = path.join(OUT, `${name}.gray`);
  const r = spawnSync('bash', ['-c',
    `adb exec-out "head -c ${HEAD_BYTES} ${q(file)}; tail -c +${offset} ${q(file)}" | ` +
    `ffmpeg -y -v info -skip_frame nokey -i pipe:0 -an -sn -dn ` +
    `-vf "showinfo,scale=320:180:force_original_aspect_ratio=decrease,format=gray" -fps_mode passthrough -f rawvideo ${q(gray)}`,
  ], { maxBuffer: 1 << 28 });
  const log = r.stderr.toString();
  const [, w, h] = log.match(/Video: rawvideo.*?gray.*?(\d+)x(\d+)/);
  const times = [...log.matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 1000));
  // Frames from the header bytes come first; only the tail's are kept.
  const frame = w * h;
  const all = fs.readFileSync(gray);
  const keep = times.map((t, i) => [t, i]).filter(([t, i]) => t >= fromS * 1000 && (i + 1) * frame <= all.length);
  fs.writeFileSync(gray, Buffer.concat(keep.map(([, i]) => all.subarray(i * frame, (i + 1) * frame))));
  const lines = [`size ${w} ${h}`, `duration ${Math.round(durationS * 1000)}`];
  if (truthS !== undefined) lines.push(`truth ${Math.round(truthS * 1000)}`);
  keep.forEach(([t]) => lines.push(`frame ${t}`));
  fs.writeFileSync(path.join(OUT, `${name}.tsv`), lines.join('\n') + '\n');
  console.log(`${name}: ${keep.length} frames ${w}x${h}, duration ${durationS.toFixed(0)} s, truth ${truthS ?? '-'}`);
}

fs.mkdirSync(OUT, { recursive: true });
process.argv.slice(2).forEach(extract);
