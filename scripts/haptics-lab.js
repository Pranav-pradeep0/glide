#!/usr/bin/env node
/**
 * PC side of the Haptics Lab (docs/haptics-engine-plan.md, Phase 0). The phone records, this scores.
 *
 *   node scripts/haptics-lab.js pull                       newest Lab CSVs -> $TMP/haptics-lab
 *   node scripts/haptics-lab.js history <seconds> [out]    L6: poll what the system played
 *   node scripts/haptics-lab.js seams <csv> [history.json] L1
 *   node scripts/haptics-lab.js calib <csv>                L5
 *   node scripts/haptics-lab.js tap <csv>                  L4
 *   node scripts/haptics-lab.js motion <csv>               L3: did the motor move during playback
 *   node scripts/haptics-lab.js perform [mix1]             Phase 2 exit: the Performer in the real player (Lab open)
 *   node scripts/haptics-lab.js listen [mix1|/phone/film] [s]  Phase 3 exit: the Listener on the phone (Lab open)
 *
 * CSV rows from HapticsLabModule.kt: `elapsedRealtimeNanos,kind,values...`.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PKG = 'com.glide.player';
const LOCAL = path.join(os.tmpdir(), 'haptics-lab');
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });

// ---------------------------------------------------------------------------- L6 history

/**
 * One `Recent vibrations` row:
 * `10-11 22:30:07.245 | effect | finished | duration: 1730ms | start: 22:30:07.247 | end: ... |
 *  ... | usage: MEDIA | com.glide.player (uid=..) | reason: null | played: Step=..., Step=... | original: ...`
 */
function parseHistoryLine(line) {
    const f = line.trim().split('|').map(s => s.trim());
    if (f.length < 8) return null;
    const field = name => (f.find(x => x.startsWith(name + ':')) ?? '').slice(name.length + 1).trim();
    const played = field('played');
    return {
        created: f[0],
        type: f[1],
        status: f[2],
        durationMs: parseInt(field('duration'), 10),
        start: field('start'),
        end: field('end'),
        usage: field('usage'),
        played,
        // Step=10ms(amplitude=0.50) -> [ms, amplitude]
        steps: [...played.matchAll(/Step=(\d+)ms\(amplitude=(-?[\d.]+)/g)].map(m => [+m[1], +m[2]]),
    };
}

/** Clock time `HH:MM:SS.mmm` -> ms of day. */
const clockMs = s => {
    const m = /(\d+):(\d+):(\d+)\.(\d+)/.exec(s);
    return m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4] : NaN;
};

/** Rows of ours in the `Recent vibrations` section (the ring is ~20 per usage, hence polling). */
function readHistory() {
    const dump = adb('shell', 'dumpsys', 'vibrator_manager');
    const recent = dump.split('Recent vibrations:')[1]?.split('Aggregated vibration history:')[0] ?? '';
    return recent.split('\n').filter(l => l.includes(PKG)).map(parseHistoryLine).filter(Boolean);
}

async function history(seconds, out) {
    const seen = new Map();
    const until = Date.now() + seconds * 1000;
    while (Date.now() < until) {
        for (const row of readHistory()) seen.set(row.created + row.start, row);
        await new Promise(r => setTimeout(r, 300));
    }
    const rows = [...seen.values()].sort((a, b) => clockMs(a.created) - clockMs(b.created));
    // External (audio-coupled) vibrations are listed by the vibrator service too; keep any mention.
    const dump = adb('shell', 'dumpsys', 'vibrator_manager');
    const external = dump.split('\n').filter(l => /external/i.test(l)).map(l => l.trim()).slice(0, 40);
    const result = { rows, external };
    if (out) fs.writeFileSync(out, JSON.stringify(result, null, 1));
    console.log(`${rows.length} rows of ${PKG}; statuses:`, count(rows.map(r => r.status)));
    return result;
}

const count = xs => xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

// ---------------------------------------------------------------------------- CSV + accel

function load(file) {
    const acc = [];
    const marks = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue;
        const [t, kind, ...v] = line.split(',');
        const ms = Number(BigInt(t) / 1000n) / 1000; // ns -> ms, kept precise
        if (kind === 'acc') acc.push([ms, +v[0], +v[1], +v[2]]);
        else marks.push({ t: ms, kind, v });
    }
    return { acc, marks, t0: marks[0]?.t ?? acc[0]?.[0] ?? 0 };
}

/**
 * Vibration energy over time: each axis minus its 40 ms moving mean (gravity and hand
 * motion are far below the motor's ~170 Hz), then RMS of the vector over [winMs].
 */
function envelope(acc, winMs = 20) {
    const n = acc.length;
    const hp = new Float64Array(n);
    for (let axis = 1; axis <= 3; axis++) {
        let lo = 0, sum = 0;
        for (let i = 0; i < n; i++) {
            sum += acc[i][axis];
            while (acc[i][0] - acc[lo][0] > 40) sum -= acc[lo++][axis];
            const d = acc[i][axis] - sum / (i - lo + 1);
            hp[i] += d * d;
        }
    }
    const env = [];
    let lo = 0, sum = 0;
    for (let i = 0; i < n; i++) {
        sum += hp[i];
        while (acc[i][0] - acc[lo][0] > winMs) sum -= hp[lo++];
        env.push([acc[i][0], Math.sqrt(sum / (i - lo + 1))]);
    }
    return env;
}

/** Envelope values with t in [a, b). */
const between = (env, a, b) => env.filter(([t]) => t >= a && t < b).map(([, e]) => e);
const pct = (xs, p) => {
    if (!xs.length) return NaN;
    const s = [...xs].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const median = xs => pct(xs, 0.5);
const r = (x, d = 3) => +x.toFixed(d);

function rate(acc) {
    const dt = [];
    for (let i = 1; i < acc.length; i++) dt.push(acc[i][0] - acc[i - 1][0]);
    return r(1000 / median(dt), 1);
}

// ---------------------------------------------------------------------------- L1 seams

function seams(file, historyFile) {
    const { acc, marks } = load(file);
    const env = envelope(acc);
    const noise = median(between(env, acc[0][0], acc[0][0] + 900));
    const beds = [];
    let bed = null;
    for (const m of marks) {
        if (m.kind === 'note' && m.v[0].startsWith('bed')) beds.push((bed = { label: m.v[0], vibs: [] }));
        else if (m.kind === 'vib' && bed) bed.vibs.push(m.t);
        else if (m.kind === 'gap' && bed) (bed.end = m.t), (bed = null);
    }
    console.log(`accel ${rate(acc)} Hz, noise ${r(noise)} m/s²`);
    const rows = beds.map(b => {
        const start = b.vibs[0];
        const window = +/window=(\d+)/.exec(b.label)[1];
        const plateau = median(between(env, start + 300, b.end - 300));
        // Deepest point within 60 ms after each boundary, relative to the plateau. Compared
        // against the same measure at the midpoints between boundaries: the dip a seam adds.
        const dipAt = t => Math.min(...between(env, t - 10, t + 60)) / plateau;
        const inner = b.vibs.slice(1).filter(t => t > start + 300 && t < b.end - 300);
        const seamsDip = inner.map(dipAt);
        const mids = inner.map(t => t - window / 2).filter(t => t > start + 300).map(dipAt);
        const late = b.vibs.map((t, i) => t - (start + i * window));
        return {
            bed: b.label,
            calls: b.vibs.length,
            plateau: r(plateau),
            seamMinP50: r(median(seamsDip)),
            seamMinWorst: r(Math.min(...seamsDip)),
            midMinP50: r(median(mids)),
            issueLateP95Ms: r(pct(late, 0.95), 2),
        };
    });
    console.table(rows);
    if (historyFile) {
        const { rows: hist } = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        const gaps = [];
        for (let i = 1; i < hist.length; i++) {
            const g = clockMs(hist[i].start) - clockMs(hist[i - 1].end);
            if (g < 1000) gaps.push(g);
        }
        console.log('history: statuses', count(hist.map(h => h.status)), 'gap end->next start ms p50/p95/max',
            median(gaps), pct(gaps, 0.95), Math.max(...gaps));
    }
    return rows;
}

// ---------------------------------------------------------------------------- L5 calibration

function calib(file) {
    const { acc, marks } = load(file);
    const env = envelope(acc);
    const quiet = between(env, acc[0][0], acc[0][0] + 900);
    const noise = median(quiet);
    const vibs = marks.filter(m => m.kind === 'vib').map(m => ({ t: m.t, amp: +m.v[0], ms: +m.v[1] }));
    const holds = vibs.filter(v => v.ms === 500);
    const byAmp = {};
    for (const h of holds) (byAmp[h.amp] ??= []).push(median(between(env, h.t + 150, h.t + 450)));
    const table = Object.entries(byAmp).map(([amp, xs]) => ({
        amp: +amp,
        pct: r((amp / 255) * 100, 1),
        rms: r(median(xs)),
        overNoise: r(median(xs) / noise, 2),
        passA: r(xs[0]),
        passB: r(xs[1] ?? NaN),
    }));
    console.log(`accel ${rate(acc)} Hz, noise ${r(noise)} m/s² (p95 ${r(pct(quiet, 0.95))})`);
    console.table(table);
    // Onset latency: from the call to the envelope first reaching half of its 500 ms peak.
    const full = holds.filter(h => h.amp === 255);
    const pulses = vibs.filter(v => v.ms !== 500).map(p => {
        const seg = env.filter(([t]) => t >= p.t - 5 && t < p.t + 250);
        const peak = Math.max(...seg.map(([, e]) => e));
        const rise = seg.find(([, e]) => e >= Math.max(peak / 2, noise * 3));
        const fall = [...seg].reverse().find(([, e]) => e >= Math.max(peak / 2, noise * 3));
        return { ms: p.ms, peak: r(peak), overNoise: r(peak / noise, 1), onsetMs: rise ? r(rise[0] - p.t, 1) : null, feltForMs: rise && fall ? r(fall[0] - rise[0], 1) : null };
    });
    const holdOnset = full.map(h => {
        const seg = env.filter(([t]) => t >= h.t - 5 && t < h.t + 300);
        const plateau = median(between(env, h.t + 150, h.t + 450));
        const reach = frac => seg.find(([, e]) => e >= plateau * frac)?.[0] - h.t;
        return { onset10: r(reach(0.1), 1), onset50: r(reach(0.5), 1), onset90: r(reach(0.9), 1) };
    });
    console.log('255 hold rise (ms to 10/50/90% of plateau):', holdOnset);
    console.table(pulses);
    return { table, pulses, holdOnset, noise };
}

// ---------------------------------------------------------------------------- L4 tap timing

function tap(file) {
    const { marks } = load(file);
    const pos = marks.filter(m => m.kind === 'pos').map(m => [m.t, +m.v[0]]);
    const taps = marks.filter(m => m.kind === 'tap').map(m => [m.t, +m.v[0] / 1000]);
    // Player position at wall time t, interpolated between polls in the same playing stretch.
    const at = t => {
        let i = pos.findIndex(([pt]) => pt >= t);
        if (i <= 0) return NaN;
        const [t0, p0] = pos[i - 1], [t1, p1] = pos[i];
        return t1 - t0 > 50 ? NaN : p0 + ((p1 - p0) * (t - t0)) / (t1 - t0);
    };
    const leads = taps.map(([t, content]) => content - at(t)).filter(Number.isFinite);
    // Skip the first second: the sink fills its buffer as fast as it can at the start.
    const settled = taps.filter(([t]) => pos.length && t > pos[0][0] + 1000).map(([t, c]) => c - at(t)).filter(Number.isFinite);
    const intervals = taps.slice(1).map(([t], i) => t - taps[i][0]);
    const out = {
        flushes: marks.filter(m => m.kind === 'note' && m.v[0].startsWith('flush')).map(m => m.v[0]),
        taps: taps.length,
        tapIntervalMsP50: r(median(intervals), 2),
        leadMsAll: { p5: r(pct(leads, 0.05), 1), p50: r(median(leads), 1), p95: r(pct(leads, 0.95), 1) },
        leadMsSettled: { min: r(Math.min(...settled), 1), p5: r(pct(settled, 0.05), 1), p50: r(median(settled), 1), p95: r(pct(settled, 0.95), 1), max: r(Math.max(...settled), 1) },
    };
    console.log(JSON.stringify(out, null, 1));
    return out;
}

// ---------------------------------------------------------------------------- L3 motion

function motion(file) {
    const { acc, marks } = load(file);
    const env = envelope(acc);
    const playing = marks.filter(m => m.kind === 'pos');
    const quiet = between(env, acc[0][0], acc[0][0] + 900);
    const during = playing.length ? between(env, playing[0].t, playing.at(-1).t) : [];
    const notes = marks.filter(m => m.kind === 'note').map(m => m.v.join(','));
    const out = {
        notes,
        quiet: { p50: r(median(quiet)), p99: r(pct(quiet, 0.99)) },
        playing: { p50: r(median(during)), p99: r(pct(during, 0.99)), max: r(Math.max(...during)) },
        // Share of playback where the envelope clears the quiet p99 by 3x: motor activity.
        activeShare: r(during.filter(e => e > 3 * pct(quiet, 0.99)).length / Math.max(1, during.length)),
    };
    console.log(JSON.stringify(out, null, 1));
    return out;
}

// ---------------------------------------------------------------------------- Phase 2 Performer

const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = code => adb('shell', 'input', 'keyevent', String(code));

/** Center of the on-screen node whose text or description is [label], from a UI dump. */
function nodeCenter(label) {
    try { adb('shell', 'uiautomator', 'dump', '/sdcard/glide-ui.xml'); } catch { adb('shell', 'uiautomator', 'dump', '/sdcard/glide-ui.xml'); }
    const xml = adb('shell', 'cat', '/sdcard/glide-ui.xml');
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`(?:text|content-desc)="${esc}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`).exec(xml);
    if (!m) return null;
    return [(+m[1] + +m[3]) >> 1, (+m[2] + +m[4]) >> 1];
}

/**
 * A horizontal drag across the middle of the player: the swipe-seek gesture. No UI dump (it
 * cannot settle while video plays); the screen size and rotation come from the window manager.
 */
function screen() {
    const [w, h] = /(\d+)x(\d+)/.exec(adb('shell', 'wm', 'size')).slice(1).map(Number);
    const rotated = /mCurrentRotation=ROTATION_(90|270)/.test(adb('shell', 'dumpsys', 'window', 'displays'));
    return rotated ? [h, w] : [w, h];
}

/** Scrolls the Lab down a little, in the left margin: mid-screen swipes land on sliders. */
function scrollDown() {
    const [, H] = screen();
    adb('shell', 'input', 'swipe', '50', String(Math.round(H * 0.7)), '50', String(Math.round(H * 0.4)), '300');
}

function swipeSeek() {
    const [W, H] = screen();
    adb('shell', 'input', 'swipe', String(Math.round(W * 0.3)), String(Math.round(H * 0.5)), String(Math.round(W * 0.7)), String(Math.round(H * 0.5)), '600');
}

/** Launches Glide and opens the Lab (Settings > Version x7). Resolves with the film path field. */
async function openLab() {
    adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1');
    for (let i = 0; i < 20 && !nodeCenter('Settings'); i++) await sleep(500);
    // Taps land before the app is ready to take them; keep at it until Settings shows.
    for (let i = 0; i < 10 && !nodeCenter('Subtitle appearance') && !nodeCenter('Version'); i++) {
        tapNode('Settings');
        await sleep(1000);
    }
    let version;
    for (let i = 0; i < 8 && !(version = nodeCenter('Version')); i++) {
        adb('shell', 'input', 'swipe', '50', '1800', '50', '600', '300'); // the left margin: mid-screen swipes land on sliders
        await sleep(600);
    }
    if (!version) throw new Error('Version row not found in Settings');
    for (let i = 0; i < 7; i++) adb('shell', 'input', 'tap', String(version[0]), String(version[1]));
    for (let i = 0; i < 10; i++) { await sleep(500); const f = nodeCenter('Film path'); if (f) return f; }
    throw new Error('Haptics Lab did not open');
}

/** Types [file] into the open Lab's film path field. */
async function enterPath(file) {
    key(224); // wake the screen: taps on a sleeping screen go nowhere
    await sleep(500);
    const field = nodeCenter('Film path') ?? await openLab();
    adb('shell', 'input', 'tap', String(field[0]), String(field[1]));
    // ctrl+a isn't reliable here (it once left the old path in place): jump to the end, delete back
    adb('shell', 'input', 'keyevent', '123', ...Array(300).fill('67'));
    adb('shell', 'input', 'text', file);
    // Enter leaves the field: the keyboard goes, and so does the blinking cursor, which keeps the
    // screen from ever settling for a UI dump. In landscape the keyboard also covers the buttons.
    key(66);
    for (let i = 0; i < 4; i++) {
        await sleep(500);
        if (/mInputShown=true/.test(adb('shell', 'dumpsys', 'input_method'))) key(4); // never the Lab: only while it shows
    }
}

function tapNode(label) {
    const at = nodeCenter(label);
    if (!at) throw new Error(`"${label}" not on screen. Open the Haptics Lab (Settings > Version x7) and run again.`);
    adb('shell', 'input', 'tap', String(at[0]), String(at[1]));
}

/** `GlideHaptics` lines as {kind, wall, ...fields}. */
function performerLog() {
    return adb('logcat', '-d', '-v', 'raw', '-s', 'GlideHaptics:W').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
        const [kind, ...rest] = line.split(' ');
        const f = { kind, line };
        for (const w of rest) {
            const i = w.indexOf('=');
            if (i > 0) f[w.slice(0, i)] = isNaN(+w.slice(i + 1)) ? w.slice(i + 1) : +w.slice(i + 1);
            else if (/^\d+:/.test(w)) {
                f.media = +w.split(':')[0];
                f.steps = w.split(':')[1].split(',').map(s => s.split('x').map(Number));
            } else f.why = w;
        }
        return f;
    });
}

/**
 * Phase 2 exit, on the phone: plays a scripted mix in the real player with its truth track,
 * pauses, resumes and seeks with media keys, and checks the system's vibration history against
 * what the Performer meant to play. The Lab must be open on screen.
 */
async function perform(name = 'mix1') {
    const fixtures = path.join(__dirname, '..', '.haptics-fixtures');
    const remote = `/sdcard/Android/data/${PKG}/files/haptics-lab`; // the app may read its own folder, not Download
    adb('shell', 'mkdir', '-p', remote);
    for (const ext of ['.mkv', '.truth.tsv']) adb('push', path.join(fixtures, name + ext), `${remote}/${name}${ext}`);

    await enterPath(`${remote}/${name}.mkv`);
    adb('logcat', '-c');

    const rows = new Map();
    const poll = () => { for (const r of readHistory()) rows.set(r.created + r.start, r); };
    const t0 = +adb('shell', 'date', '+%s%3N').trim(); // phone clock, as the history uses
    const today = adb('shell', 'date', '+%m-%d').trim();
    tapNode('Performer test');
    const started = Date.now();
    while (!performerLog().some(l => l.kind === 'open') && Date.now() - started < 15000) await sleep(300);
    const run = async ms => { const until = Date.now() + ms; while (Date.now() < until) { poll(); await sleep(300); } };
    await run(15000);
    key(127); await run(3000);   // pause
    key(126); await run(5000);   // play
    swipeSeek(); await run(10000); // drag across the player, as a person would
    key(127); await run(1500);
    key(4); // leave the player

    const tz = /([+-])(\d\d)(\d\d)/.exec(adb('shell', 'date', '+%z'));
    const tzMs = (tz[1] === '-' ? -1 : 1) * (+tz[2] * 60 + +tz[3]) * 60000;
    const dayMs = wall => (wall + tzMs) % 86400000;
    const log = performerLog();
    const calls = log.filter(l => l.kind === 'call');
    // A call the system drops for a more important vibration (a notification) has no start time.
    const history = [...rows.values()].filter(r => r.usage === 'MEDIA').map(r => ({ ...r, startMs: clockMs(r.start) || clockMs(r.created), endMs: clockMs(r.end) }));
    const first = dayMs(t0);
    const ours = history.filter(r => r.created.startsWith(today) && r.startMs >= first);

    // Each call against the history row that started with it.
    const used = new Set();
    const mismatches = [];
    for (const c of calls) {
        const t = dayMs(c.wall);
        const row = ours.filter(r => !used.has(r) && Math.abs(r.startMs - t) <= 50).sort((a, b) => Math.abs(a.startMs - t) - Math.abs(b.startMs - t))[0];
        if (!row) { mismatches.push(`call at media ${c.media} ms: not in history`); continue; }
        if (row.status === 'ignored_for_higher_importance') { used.add(row); c.blocked = true; continue; }
        used.add(row);
        c.row = row;
        const want = c.steps.map(([ms, amp]) => [Math.max(1, Math.round(ms / c.rate)), +(amp / 255).toFixed(2)]);
        const got = row.steps;
        const finished = row.status === 'finished';
        const n = finished ? want.length : got.length;
        const ok = got.length === n && got.every(([ms, amp], i) =>
            Math.abs(amp - want[i][1]) <= 0.006 && (ms === want[i][0] || (!finished && i === n - 1 && ms <= want[i][0])));
        if (!ok) mismatches.push(`call at media ${c.media} ms (${row.status}): wanted ${JSON.stringify(want)} played ${JSON.stringify(got)}`);
    }
    const extra = ours.filter(r => !used.has(r));

    // Paused windows: from each sync playing=false to the next playing=true.
    const syncs = log.filter(l => l.kind === 'sync');
    const pausedLeaks = [];
    syncs.forEach((s, i) => {
        if (s.playing !== 'false') return;
        const resume = syncs.slice(i + 1).find(x => x.playing === 'true');
        const [a, b] = [dayMs(s.wall) + 20, resume ? dayMs(resume.wall) : Infinity];
        for (const r of ours) if (r.startMs > a && r.startMs < b) pausedLeaks.push(`vibration started ${r.startMs - a + 20} ms into a pause`);
        for (const r of ours) if (r.startMs < a && r.status === 'finished' && r.endMs - 100 > a + 30) pausedLeaks.push(`vibration ran on through a pause (${r.status})`);
    });

    // After a seek: nothing from before the new position.
    // A seek is any logged position more than a second away from where the clock had it.
    const seekLeaks = [];
    const timeline = log.filter(l => l.kind === 'sync' || l.kind === 'anchor');
    const jumps = timeline.filter((s, i) => {
        const p = timeline[i - 1];
        if (!p) return false;
        const expected = p.playing === 'false' ? p.pos : p.pos + (s.wall - p.wall) * (p.rate ?? 1);
        return Math.abs(s.pos - expected) > 1000;
    });
    for (const c of calls) {
        const j = jumps.filter(x => x.wall < c.wall).at(-1);
        if (j && c.media < j.pos - 20) seekLeaks.push(`call at media ${c.media} ms after seeking to ${j.pos} ms`);
    }
    for (const j of jumps) for (const r of ours) {
        const t = dayMs(j.wall);
        if (r.startMs < t && r.status === 'finished' && r.endMs - 100 > t + 30) seekLeaks.push(`vibration ran on through a seek`);
    }
    const seeks = jumps.length;

    const late = calls.map(c => Math.abs(c.late));
    // True timing: each call against the settled clock, the first anchor after it (no jump between).
    const latency = log.find(l => l.kind === 'open')?.latency ?? 0;
    const anchors = log.filter(l => l.kind === 'anchor');
    const timing = calls.map(c => {
        const jump = syncs.find(s => s.wall > c.wall);
        // Median of the settled samples over the next 5 s: one sample jitters by a few ms.
        const near = anchors.filter(x => x.wall > c.wall && x.wall < c.wall + 5000 && Math.abs(x.err) <= 20 && (!jump || x.wall < jump.wall));
        const offset = median(near.map(a => a.wall - a.pos / c.rate)); // wall clock of media 0
        return near.length ? Math.abs(c.wall - (offset + c.media / c.rate - latency)) : NaN;
    }).filter(x => !isNaN(x));
    const anchor = log.filter(l => l.kind === 'anchor').map(l => Math.abs(l.err));
    const report = {
        calls: calls.length,
        historyRows: ours.length,
        statuses: count(ours.map(r => r.status)),
        schedulerLateP50: pct(late, 0.5), schedulerLateP95: pct(late, 0.95), schedulerLateMax: Math.max(...late),
        timingErrP50: pct(timing, 0.5), timingErrP95: pct(timing, 0.95), timingErrMax: Math.max(...timing), timed: timing.length,
        blockedBySystem: calls.filter(c => c.blocked).length,
        anchorErrP50: pct(anchor, 0.5), anchorErrP95: pct(anchor, 0.95),
        pauses: syncs.filter(s => s.playing === 'false').length, seeks,
    };
    console.log(report);
    const checks = [
        ['scheduler error p95 <= 10 ms (vs the settled player clock)', report.timingErrP95 <= 10],
        ['every call is in the history, as intended', calls.length > 0 && mismatches.length === 0],
        ['nothing in the history we did not call', extra.length === 0],
        ['zero haptics while paused', report.pauses > 0 && pausedLeaks.length === 0],
        ['zero stale haptics after seek', seeks > 0 && seekLeaks.length === 0],
    ];
    for (const [what, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    for (const m of [...mismatches, ...extra.map(r => `unexpected ${r.status} at ${r.start}: ${r.played}`), ...pausedLeaks, ...seekLeaks].slice(0, 20)) console.log('  ', m);
    const out = path.join(LOCAL, `perform-${name}-${Date.now()}.json`);
    fs.mkdirSync(LOCAL, { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ report, log, history: ours }, null, 1));
    console.log(out);
    process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
}

/** `GlideHaptics` and `GlidePlayer` lines as {kind, sub, ...key=value fields}. */
function listenLog() {
    return adb('logcat', '-d', '-v', 'raw', '-s', 'GlideHaptics:W', 'GlidePlayer:W').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
        const [kind, sub, ...rest] = line.split(' ');
        const f = { kind, sub, line };
        for (const w of [sub, ...rest]) {
            const i = w.indexOf('=');
            if (i > 0) f[w.slice(0, i)] = isNaN(+w.slice(i + 1)) ? w.slice(i + 1) : +w.slice(i + 1);
        }
        return f;
    });
}

/** Priority (nice) of the decoder and analysis threads, as `ps` shows them. */
function threadNice() {
    const pid = adb('shell', 'pidof', PKG).trim();
    if (!pid) return '';
    return adb('shell', 'ps', '-T', '-p', pid, '-o', 'NI,CMD').split('\n')
        .filter(l => /haptics-listen|SimpleDecoder|ExoPlayer:Simpl|CCodec|c2\./.test(l)).map(l => l.trim().replace(/\s+/, ' nice=')).join('; ');
}

/**
 * Phase 3 exit, on the phone: plays a file with the Listener's haptics (Lab > Listener test), twice:
 * first while it is analysed, then from the cache. A fixture name is pushed under a fresh mtime so it
 * is analysed again, and its hits are scored against the truth; a path on the phone is a film.
 * Checks that analysis stays ahead of the playhead, and reports decoder priority and dropped frames
 * with and without analysis running. The Lab must be open on screen.
 */
async function listen(target = 'mix1', seconds = 40) {
    let file = target;
    let truth = null;
    if (!target.startsWith('/')) {
        const fixtures = path.join(__dirname, '..', '.haptics-fixtures');
        const remote = `/sdcard/Android/data/${PKG}/files/haptics-lab`;
        adb('shell', 'mkdir', '-p', remote);
        file = `${remote}/listen-${target}.mkv`;
        adb('push', path.join(fixtures, `${target}.mkv`), file);
        adb('shell', 'touch', file); // a new fingerprint: analysed, not read from the cache
        truth = fs.readFileSync(path.join(fixtures, `${target}.truth.tsv`), 'utf8').split('\n')
            .map(l => l.trim().split(/\s+/)).filter(w => w[0] === 'onset').map(w => +w[1]);
    }
    await enterPath(file);

    const passes = [];
    for (const pass of ['analysing', 'cached']) {
        adb('logcat', '-c');
        for (let i = 0; i < 10 && !nodeCenter('Listener test'); i++) { // the keyboard may cover it, or the Lab sits scrolled up
            if (i >= 2) scrollDown();
            await sleep(500);
        }
        tapNode('Listener test');
        let threads = '';
        for (const until = Date.now() + seconds * 1000; Date.now() < until;) {
            await sleep(2000);
            const log = listenLog();
            if (!threads && log.some(l => l.kind === 'listen' && l.sub === 'progress')) threads = threadNice(); // while analysing
        }
        key(4); // leave the player: it logs its dropped frames
        await sleep(2000);
        passes.push({ pass, threads, log: listenLog() });
    }

    const checks = [];
    for (const { pass, threads, log } of passes) {
        const done = log.find(l => l.kind === 'listen' && l.sub === 'done');
        const cached = log.find(l => l.kind === 'listen' && l.sub === 'cached');
        const progress = log.filter(l => l.kind === 'listen' && l.sub === 'progress');
        const covered = wall => (cached || (done && wall >= done.wall)) ? Infinity
            : Math.max(0, ...progress.filter(p => p.wall <= wall).map(p => p.analysed));
        const heads = log.filter(l => (l.kind === 'anchor' || (l.kind === 'sync' && l.playing === 'true')) && l.wall);
        // After each start or jump: how long until analysis passes the playhead. Once past, it
        // must stay past while playing (falling behind = an anchor not covered after one that was).
        const waits = [];
        let fellBehind = 0, jumpWall = null, ahead = false;
        for (const h of heads) {
            if (h.kind === 'sync') { jumpWall = h.wall; ahead = false; }
            const ok = covered(h.wall) > h.pos;
            if (ok && !ahead && jumpWall !== null) { waits.push(`${h.wall - jumpWall} ms at ${Math.round(h.pos / 1000)} s`); jumpWall = null; }
            if (!ok && ahead && h.kind === 'anchor') fellBehind++;
            ahead = ok;
        }
        const dropped = log.find(l => l.sub?.startsWith('dropped'));
        console.log(`\n${pass}: ${cached ? `cached track, ${cached.events} hits` : done
            ? `analysed ${(done.analysed / 60000).toFixed(1)} min in ${(done.took / 1000).toFixed(1)} s (${Math.round(done.analysed / done.took)}x realtime), ${done.events} hits${done.error && done.error !== 'null' ? `, error ${done.error}` : ''}`
            : `not finished, analysed ${(covered(Date.now() * 2) / 1000).toFixed(0)} s`}`);
        console.log(`   analysis passed the playhead, after each start or jump: ${waits.join(', ') || 'never'}`);
        if (threads) console.log(`   threads: ${threads}`);
        if (dropped) console.log(`   ${dropped.line}`);
        checks.push([`${pass}: analysis stays ahead of the playhead (${heads.length} samples)`, waits.length > 0 && fellBehind === 0]);

        if (truth && done) {
            const events = log.filter(l => l.sub === 'events').flatMap(l => l.line.split(' ').pop().split(',').map(Number));
            const used = new Set();
            const errors = [];
            for (const t of truth) {
                const i = events.map((e, k) => k).filter(k => !used.has(k) && Math.abs(events[k] - t) <= 50)
                    .sort((a, b) => Math.abs(events[a] - t) - Math.abs(events[b] - t))[0];
                if (i !== undefined) { used.add(i); errors.push(Math.abs(events[i] - t)); }
            }
            const recall = errors.length / truth.length, precision = events.length ? errors.length / events.length : 0;
            const f1 = errors.length ? 2 * precision * recall / (precision + recall) : 0;
            const p50 = errors.sort((a, b) => a - b)[Math.max(0, Math.ceil(errors.length / 2) - 1)];
            checks.push([`hit F1 on the phone ${f1.toFixed(3)} >= 0.9`, f1 >= 0.9]);
            checks.push([`hit timing p50 on the phone ${p50} ms <= 10`, p50 <= 10]);
        }
    }
    console.log('');
    for (const [what, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    const out = path.join(LOCAL, `listen-${path.basename(file)}-${Date.now()}.json`);
    fs.mkdirSync(LOCAL, { recursive: true });
    fs.writeFileSync(out, JSON.stringify(passes, null, 1));
    console.log(out);
    process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
}

// ---------------------------------------------------------------------------- pull

function pull() {
    fs.mkdirSync(LOCAL, { recursive: true });
    adb('pull', `/sdcard/Android/data/${PKG}/files/haptics-lab/.`, LOCAL);
    const files = fs.readdirSync(LOCAL).filter(f => f.endsWith('.csv')).sort((a, b) => +a.split('-').at(-1).slice(0, -4) - +b.split('-').at(-1).slice(0, -4));
    for (const f of files.slice(-6)) console.log(path.join(LOCAL, f));
}

/** `node scripts/haptics-lab.js check`: the parser against a real row from the reference phone. */
function check() {
    const assert = require('assert');
    const row = parseHistoryLine('      10-11 22:31:24.441 |   effect | cancelled_superseded | duration:  1542ms | start: 22:31:24.444 | end: 22:31:25.984 | scale:     NONE (adaptive=1.00) | flags:    0 | usage: MEDIA | com.glide.app (uid=10628, deviceId=0) | reason: null | played: Step=10ms(amplitude=0.50), Step=2000ms(amplitude=1.00) | original: Step=2000ms(amplitude=-1.00)');
    assert.strictEqual(row.status, 'cancelled_superseded');
    assert.strictEqual(row.durationMs, 1542);
    assert.strictEqual(row.usage, 'MEDIA');
    assert.deepStrictEqual(row.steps, [[10, 0.5], [2000, 1]]);
    assert.strictEqual(clockMs(row.end) - clockMs(row.start), 1540);
    console.log('ok');
}

const [cmd, ...args] = process.argv.slice(2);
const commands = {
    check,
    pull,
    history: () => history(+args[0] || 30, args[1]),
    seams: () => seams(args[0], args[1]),
    calib: () => calib(args[0]),
    tap: () => tap(args[0]),
    motion: () => motion(args[0]),
    perform: () => perform(args[0]),
    listen: () => listen(args[0], +args[1] || undefined),
};
if (!commands[cmd]) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    process.exit(1);
}
commands[cmd]();

module.exports = { parseHistoryLine, envelope };
