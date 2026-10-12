#!/usr/bin/env node
// Generated test clips for the haptics harness (docs/haptics-engine-plan.md, Phase 1).
// Every clip is a 16-bit 48 kHz WAV plus a .truth.tsv whose times are exact to the sample,
// because this script places every sound itself. ffmpeg is used only for flite speech and for
// decoding a real film as a mix base.
//
//   node scripts/haptics-fixtures.js [outDir]                      all generated clips
//   node scripts/haptics-fixtures.js mix --base <film> [--start s] [--dur s] [--seed n] [--name x] [--out dir]
//                                                                  events dropped into real audio
//
// Truth lines: onset <ms> <label> | bed <startMs> <endMs> <label> | quiet <startMs> <endMs> <label>
//              | lfe <channel> | partial (truth onsets are incomplete: score recall, not F1)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RATE = 48000;
const DEFAULT_OUT = path.join(__dirname, '..', '.haptics-fixtures');
const QUIET_MARGIN_MS = 500; // events don't make the speech/music around them "quiet"
const BED_HZ = 120; // a sweep is bed while it is below this

// ---------- basics ----------

function rng(seed) { // mulberry32
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ms = (samples) => Math.round((samples * 1000) / RATE);
const sec = (s) => Math.round(s * RATE);

function writeWav(file, channels) { // channels: Float32Array[] of equal length
  const n = channels[0].length, ch = channels.length;
  const buf = Buffer.alloc(44 + n * ch * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * ch * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * ch * 2, 28); buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * ch * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767), o); o += 2;
  }
  fs.writeFileSync(file, buf);
}

function readWavMono(file) { // 16-bit PCM, channels averaged
  const b = fs.readFileSync(file);
  let o = 12, ch = 0, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') ch = b.readUInt16LE(o + 10);
    if (id === 'data') data = b.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size & 1);
  }
  const n = Math.floor(data.length / (2 * ch)), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += data.readInt16LE((i * ch + c) * 2);
    out[i] = s / ch / 32768;
  }
  return out;
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${r.stderr || r.error}`);
}

function add(dst, src, at, gain = 1) {
  for (let i = 0; i < src.length && at + i < dst.length; i++) if (at + i >= 0) dst[at + i] += src[i] * gain;
}

function lowpass(x, hz) { // one-pole, run twice for a gentler noise colour
  const a = 1 - Math.exp((-2 * Math.PI * hz) / RATE);
  for (let pass = 0; pass < 2; pass++) { let y = 0; for (let i = 0; i < x.length; i++) x[i] = y += a * (x[i] - y); }
  return x;
}

function normalize(x, peak) {
  let m = 0; for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}

function writeTruth(file, lines) { fs.writeFileSync(file, lines.join('\n') + '\n'); }

// Sorted [start, end] spans minus the holes, all in ms.
function subtract(spans, holes) {
  let out = spans;
  for (const [hs, he] of holes) out = out.flatMap(([s, e]) => [[s, Math.min(e, hs)], [Math.max(s, he), e]].filter(([a, b]) => b - a > 0));
  return out;
}

// ---------- sounds (each starts exactly at sample 0) ----------

function click(r, amp) {
  const x = new Float32Array(sec(0.003));
  for (let i = 0; i < x.length; i++) x[i] = (r() * 2 - 1) * amp * Math.exp(-i / sec(0.001));
  x[0] = amp; // the onset is sample 0, not the first loud noise sample
  return x;
}

function subHit(hz) {
  const x = new Float32Array(sec(0.4));
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE;
    x[i] = 0.9 * Math.sin(2 * Math.PI * hz * t) * Math.min(1, t / 0.005) * Math.exp(-t / 0.08);
  }
  return x;
}

function impact(r) {
  const x = new Float32Array(sec(0.15));
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE;
    x[i] = (r() * 2 - 1) * Math.exp(-t / 0.02) * 0.6 + Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t / 0.05) * 0.5;
  }
  return normalize(x, 0.9);
}

function explosion(r) {
  const x = new Float32Array(sec(1.5));
  for (let i = 0; i < x.length; i++) x[i] = r() * 2 - 1;
  lowpass(x, 300);
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE;
    x[i] = x[i] * Math.min(1, t / 0.005) * Math.exp(-t / 0.4) * 8 + Math.sin(2 * Math.PI * 35 * t) * Math.min(1, t / 0.005) * Math.exp(-t / 0.5) * 0.4;
  }
  return normalize(x, 0.95);
}

function engine(seconds) {
  const x = new Float32Array(sec(seconds));
  const fade = sec(0.3);
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE, saw = 2 * ((38 * t) % 1) - 1;
    x[i] = saw * (1 + 0.3 * Math.sin(2 * Math.PI * 7 * t)) * Math.min(1, i / fade, (x.length - i) / fade);
  }
  return normalize(lowpass(x, 150), 0.6);
}

function rumble(r, seconds) { // LFE content: a few low sines, slowly swelling
  const x = new Float32Array(sec(seconds));
  const fade = sec(0.2), ph = [r(), r(), r()].map((p) => p * 2 * Math.PI);
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE;
    x[i] = (Math.sin(2 * Math.PI * 35 * t + ph[0]) + Math.sin(2 * Math.PI * 50 * t + ph[1]) + 0.7 * Math.sin(2 * Math.PI * 63 * t + ph[2]))
      * (0.75 + 0.25 * Math.sin(2 * Math.PI * 0.8 * t)) * Math.min(1, i / fade, (x.length - i) / fade);
  }
  return normalize(x, 0.8);
}

function music(seconds, seed) { // mid-register notes and a pad: no bass, no drums
  const r = rng(seed), x = new Float32Array(sec(seconds));
  const scale = [262, 294, 330, 349, 392, 440, 494, 523, 587, 659, 698, 784];
  const chords = [[196, 247, 294], [220, 262, 330], [175, 220, 262], [196, 247, 294]];
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE, chord = chords[Math.floor(t / 2) % chords.length];
    x[i] = chord.reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) * 0.08;
  }
  for (let at = 0; at < x.length; at += sec(0.5)) {
    const f = scale[Math.floor(r() * scale.length)], note = new Float32Array(sec(1.2));
    for (let i = 0; i < note.length; i++) {
      const t = i / RATE;
      note[i] = [1, 0.5, 0.33, 0.25].reduce((s, a, h) => s + a * Math.sin(2 * Math.PI * f * (h + 1) * t), 0) * Math.min(1, t / 0.01) * Math.exp(-t / 0.4) * 0.3;
    }
    add(x, note, at);
  }
  return normalize(x, 0.7);
}

const SENTENCES = [
  'The meeting was moved to Thursday because the room was booked.',
  'I told him we would need more time to finish the report.',
  'She walked to the station and waited for the last train home.',
  'Do you remember the name of the restaurant near the river.',
  'We should leave early tomorrow if the weather stays clear.',
  'Nobody expected the old house to sell so quickly.',
  'He kept the letter in a drawer for almost ten years.',
  'Can you call me back when you get this message.',
];

function speech(seconds, tmp) { // flite sentences in two voices with short pauses
  const x = new Float32Array(sec(seconds));
  let at = sec(0.3), k = 0;
  while (at < x.length) {
    const wav = path.join(tmp, `s${k}.wav`);
    ffmpeg(['-f', 'lavfi', '-i', `flite=text='${SENTENCES[k % SENTENCES.length]}':voice=${k % 2 ? 'rms' : 'slt'}`,
      '-ar', String(RATE), '-ac', '1', '-c:a', 'pcm_s16le', '-fflags', '+bitexact', '-map_metadata', '-1', wav]);
    const s = normalize(readWavMono(wav), 0.8);
    add(x, s, at);
    at += s.length + sec(0.4);
    k++;
  }
  return x;
}

// Seeded start times (samples) for sounds of the given lengths, spaced at least gap apart.
function place(r, total, lengths, gap, lead = sec(0.5)) {
  const out = [];
  let at = lead;
  for (const len of lengths) {
    at += Math.floor(r() * gap);
    if (at + len > total - sec(0.3)) break;
    out.push(at);
    at += len + gap;
  }
  return out;
}

// ---------- clips ----------

function clicks(out) {
  const r = rng(1), x = new Float32Array(sec(20)), truth = [];
  for (const at of place(r, x.length, Array(60).fill(sec(0.003)), sec(0.3))) {
    add(x, click(r, 0.2 + 0.8 * r()), at);
    truth.push(`onset ${ms(at)} click`);
  }
  writeWav(path.join(out, 'clicks.wav'), [x, x]);
  writeTruth(path.join(out, 'clicks.truth.tsv'), truth);
}

function subbass(out) {
  const r = rng(2), x = new Float32Array(sec(20)), truth = [];
  place(r, x.length, Array(40).fill(sec(0.4)), sec(0.4)).forEach((at, k) => {
    const hz = k % 2 ? 60 : 45;
    add(x, subHit(hz), at);
    truth.push(`onset ${ms(at)} sub${hz}`);
  });
  writeWav(path.join(out, 'subbass.wav'), [x, x]);
  writeTruth(path.join(out, 'subbass.truth.tsv'), truth);
}

function sweeps(out) { // 200 -> 20 Hz, then 20 -> 200 Hz, log, 8 s each
  const x = new Float32Array(sec(21)), truth = [], T = 8;
  for (const [start, f0, f1] of [[1, 200, 20], [11, 20, 200]]) {
    const k = Math.log(f1 / f0) / T, s0 = sec(start), n = sec(T), fade = sec(0.05);
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      x[s0 + i] = 0.5 * Math.sin((2 * Math.PI * f0 * (Math.exp(k * t) - 1)) / k) * Math.min(1, i / fade, (n - i) / fade);
    }
    const tb = Math.log(BED_HZ / f0) / k; // when the sweep crosses BED_HZ
    const [bs, be] = f0 > f1 ? [start + tb, start + T] : [start, start + tb];
    truth.push(`bed ${Math.round(bs * 1000)} ${Math.round(be * 1000)} sweep`);
  }
  writeWav(path.join(out, 'sweeps.wav'), [x, x]);
  writeTruth(path.join(out, 'sweeps.truth.tsv'), truth);
}

function quietClip(out, name, x, label) {
  writeWav(path.join(out, `${name}.wav`), [x, x]);
  writeTruth(path.join(out, `${name}.truth.tsv`), [`quiet 0 ${ms(x.length)} ${label}`]);
}

function silence(out) {
  const r = rng(3), x = new Float32Array(sec(20));
  for (let i = 0; i < x.length; i++) x[i] = (r() * 2 - 1) * 1e-4; // dither, about -80 dBFS
  quietClip(out, 'silence', x, 'silence');
}

function lfe51(out, talk) { // FL FR FC LFE BL BR
  const r = rng(4), n = sec(30), lfe = new Float32Array(n), truth = ['lfe 3'], beds = [];
  const lengths = Array.from({ length: 12 }, () => sec(1.5 + 2.5 * r()));
  place(r, n, lengths, sec(1.5)).forEach((at, k) => {
    add(lfe, rumble(r, lengths[k] / RATE), at);
    beds.push([ms(at), ms(at + lengths[k])]);
    truth.push(`bed ${ms(at)} ${ms(at + lengths[k])} lfe`);
  });
  const fc = talk.slice(0, n), side = music(30, 5).map((v) => v * 0.3);
  for (const [s, e] of subtract([[0, ms(n)]], beds.map(([s, e]) => [s - QUIET_MARGIN_MS, e + QUIET_MARGIN_MS]))) truth.push(`quiet ${s} ${e} speech`);
  writeWav(path.join(out, 'lfe51.wav'), [side, side, fc, lfe, side, side]);
  writeTruth(path.join(out, 'lfe51.truth.tsv'), truth);
}

// Drops impacts, explosions and engines into base at seeded times. baseSpans labels the base
// ([startMs, endMs, label]) for quiet regions; null means the base is real audio with unknown events.
function mixInto(base, baseSpans, seed) {
  const r = rng(seed), truth = [], holes = [];
  const kinds = Array.from({ length: 30 }, () => ['impact', 'impact', 'explosion', 'engine'][Math.floor(r() * 4)]);
  const sounds = kinds.map((k) => (k === 'impact' ? impact(r) : k === 'explosion' ? explosion(r) : engine(2.5 + 1.5 * r())));
  place(r, base.length, sounds.map((s) => s.length), sec(1.0), sec(1.0)).forEach((at, k) => {
    add(base, sounds[k], at);
    const s = ms(at), e = ms(at + sounds[k].length);
    truth.push(kinds[k] === 'engine' ? `bed ${s} ${e} engine` : `onset ${s} ${kinds[k]}`);
    holes.push([s - QUIET_MARGIN_MS, e + QUIET_MARGIN_MS]);
  });
  if (!baseSpans) truth.push('partial');
  else for (const [bs, be, label] of baseSpans) for (const [s, e] of subtract([[bs, be]], holes)) truth.push(`quiet ${s} ${e} ${label}`);
  return truth;
}

function scriptedMix(out, k, talk, seed) { // 60 s of alternating speech and music, then events
  const r = rng(seed), x = new Float32Array(sec(60)), spans = [], tune = music(60, seed + 100);
  for (let at = 0, speaking = r() < 0.5; at < x.length; speaking = !speaking) {
    const len = Math.min(sec(8 + 6 * r()), x.length - at);
    add(x, (speaking ? talk : tune).subarray(at, at + len), at, speaking ? 0.5 : 0.35);
    spans.push([ms(at), ms(at + len), speaking ? 'speech' : 'music']);
    at += len;
  }
  const truth = mixInto(x, spans, seed);
  writeWav(path.join(out, `mix${k}.wav`), [x, x]);
  writeTruth(path.join(out, `mix${k}.truth.tsv`), truth);
}

function realMix(argv) {
  const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
  const film = opt('base'), out = opt('out', DEFAULT_OUT), seed = Number(opt('seed', 7));
  if (!film) throw new Error('mix needs --base <film>');
  const name = opt('name', `real-${path.parse(film).name.replace(/\W+/g, '-').toLowerCase()}-${seed}`);
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glide-hfx-')), wav = path.join(tmp, 'base.wav');
  ffmpeg(['-ss', opt('start', '600'), '-t', opt('dur', '60'), '-i', film, '-vn', '-ac', '1', '-ar', String(RATE),
    '-c:a', 'pcm_s16le', '-fflags', '+bitexact', '-map_metadata', '-1', wav]);
  const x = readWavMono(wav);
  fs.rmSync(tmp, { recursive: true, force: true });
  const truth = mixInto(x, null, seed);
  writeWav(path.join(out, `${name}.wav`), [x, x]);
  writeTruth(path.join(out, `${name}.truth.tsv`), truth);
  console.log(`${name}: ${truth.length - 1} events`);
}

function all(out) {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glide-hfx-'));
  try {
    const talk = speech(60, tmp);
    clicks(out); subbass(out); sweeps(out); silence(out);
    quietClip(out, 'speech', talk.slice(0, sec(30)), 'speech');
    quietClip(out, 'music', music(30, 6), 'music');
    lfe51(out, talk);
    [11, 12, 13].forEach((seed, k) => scriptedMix(out, k + 1, talk, seed));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`fixtures in ${out}: ${fs.readdirSync(out).filter((f) => f.endsWith('.wav')).length} clips`);
}

if (process.argv[2] === 'mix') realMix(process.argv.slice(3));
else all(process.argv[2] || DEFAULT_OUT);
