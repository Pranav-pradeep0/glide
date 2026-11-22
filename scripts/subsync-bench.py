"""
Auto subtitle sync benchmark on the haptics fixture films: a Python port of SubtitleAligner.kt and
SubtitleAutoSync.ts (speech cues, 8 x 60 s clips, loudness and YAMNet Speech per clip, summed over
clips, every frame-rate ratio, the viewer's side of a mid-film edit). Each film's subtitle in
.haptics-fixtures/films is in sync (-0.1 to +0.2 s); it is shifted by known delays, retimed for other
frame rates, swapped for each other film's, or given a delay that changes halfway (viewer at 25% and
75%). Scored: right (|err| <= 0.3 s; ratio mapping within 0.3 s at 10/50/90% of the film), wrong
(anything else applied), refused. Speech-band loudness (as the phone meters it) is cached next to each
film as <name>.levels.npy; needs ffmpeg on PATH and <name>.sounds from haptics-yamnet.py.

Run: .haptics-fixtures/venv/Scripts/python -I scripts/subsync-bench.py [pool size, default 8] [energy]
("energy" leaves YAMNet out, as the phone does when it cannot load.) ~3 min with 8 workers.
"""
import os, re, struct, subprocess, sys
os.environ['OPENBLAS_NUM_THREADS'] = os.environ['OMP_NUM_THREADS'] = '1'
from multiprocessing import Pool
import numpy as np

FILMS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.haptics-fixtures', 'films')
F, MAX_SHIFT = 0.01, 150.0
MAXLAG = round(MAX_SHIFT / F)
RATIOS = [1.0, 25 / 23.976, 23.976 / 25, 25 / 24, 24 / 25, 24 / 23.976, 23.976 / 24]
MIN_Z, MAX_RUNNER, GUARD, RATIO_EXTRA_Z, SUPPORT_Z, DISAGREE_Z, DETREND = 6.0, 0.6, 100, 1.0, 2.0, 5.0, 8.0
CLIP_S, CLIPS, MIN_CLIP_CUES, MAX_CUE_S = 60, 8, 5, 12
TIGHT_Z, TIGHT_FRAMES = 6.0, 25
DELAYS = [0, 0.8, -2.3, 6.7, -18.4, 41.2, -95.5, 130.2]
DRIFTS = {'25/23.976': 25 / 23.976, '23.976/25': 23.976 / 25, '25/24': 25 / 24, '24/23.976': 24 / 23.976}
EDITS = [2.0, -5.0, 12.0]  # delay 0 for the first half of the film, then this
ENERGY_ONLY = 'energy' in sys.argv[1:]


def levels(name):
    """Speech-band dB per 10 ms: centre of 5.1 (else channel mean), RBJ HP 300 / LP 3000 Hz, Q 0.7071."""
    path = os.path.join(FILMS, name + '.levels.npy')
    if os.path.exists(path):
        return np.load(path)
    src = os.path.join(FILMS, name + '.mka')
    ch = int(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels',
                             '-of', 'csv=p=0', src], capture_output=True, text=True).stdout.strip())
    pick = 'pan=mono|c0=FC' if ch in (6, 8) else 'pan=mono|c0=' + '+'.join(f'{1 / ch:.6f}*c{i}' for i in range(ch))
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', src, '-map', '0:a:0', '-af',
                          pick + ',highpass=f=300:p=2:t=q:w=0.7071,lowpass=f=3000:p=2:t=q:w=0.7071',
                          '-ar', '48000', '-f', 'f32le', '-'], stdout=subprocess.PIPE)
    out, rest = [], np.zeros(0, np.float32)
    while b := p.stdout.read(480 * 6000 * 4):
        x = np.concatenate([rest, np.frombuffer(b, np.float32)]); k = len(x) // 480
        out.append((10 * np.log10((x[:k * 480].astype(np.float64).reshape(k, 480) ** 2).mean(1) + 1e-10)).astype(np.float32))
        rest = x[k * 480:]
    p.wait()
    lv = np.concatenate(out); np.save(path, lv)
    return lv


def yamnet_speech(name, n_frames):
    """SubtitleAligner.scoreFrames over the whole film's YAMNet Speech scores."""
    raw = open(os.path.join(FILMS, name + '.sounds'), 'rb').read(); n = struct.unpack('>i', raw[:4])[0]
    sp = np.frombuffer(raw[4:4 + n * 521], np.uint8).reshape(n, 521)[:, 0] / 255.0
    return np.interp(np.arange(n_frames) * F, np.arange(n) * 0.48 + 0.4875, sp).astype(np.float32)


def speech_cues(name):
    """isSpeechCue over the .srt: no music, no sound-only tags, at most MAX_CUE_S long."""
    t = open(os.path.join(FILMS, name + '.srt'), encoding='utf-8-sig', errors='replace').read().replace('\r', '')
    cues = []
    for b in re.split(r'\n\n+', t):
        m = re.search(r'(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)', b)
        if not m:
            continue
        g = list(map(int, m.groups()))
        s, e = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000, g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        text = b[m.end():].partition('\n')[2]
        bare = re.sub(r'[\s\d.,!?\'"…:;\-–—]', '', re.sub(r'\[[^\]]*\]|\([^)]*\)', '', re.sub(r'<[^>]*>|\{[^}]*\}', '', text)))
        if 0 < e - s <= MAX_CUE_S and not re.search('[♪♫]', text) and len(bare) >= 2:
            cues.append((s, e))
    cues.sort()
    return np.array([c[0] for c in cues]), np.array([c[1] for c in cues])


def choose_clips(starts, ends):
    """SubtitleAutoSync.chooseClips: densest CLIP_S stretch in each of CLIPS parts of the dialogue."""
    span, out = ends.max(), []
    for j in range(CLIPS):
        a = max(span * j / CLIPS, out[-1] + CLIP_S if out else 0)  # never overlapping: same audio twice
        z = span * (j + 1) / CLIPS - CLIP_S
        best, bc = None, 0
        for t in np.arange(a, max(a, z) + 1e-9, 5.0):
            c = np.sum((starts >= t) & (ends <= t + CLIP_S))
            if c > bc: best, bc = t, c
        if bc >= MIN_CLIP_CUES: out.append(best)
    return out if len(out) >= 2 else []


def standardised(lv, clip):
    a = np.clip(lv, -80, 0).astype(np.float64) if clip else lv.astype(np.float64)
    p = np.concatenate([[0], np.cumsum(a)]); half = round(DETREND / 2 / F); i = np.arange(len(a))
    lo, hi = np.maximum(0, i - half), np.minimum(len(a), i + half + 1)
    d = a - (p[hi] - p[lo]) / (hi - lo)
    return None if d.std() < 1e-6 else (d - d.mean()) / d.std()


def lag_curve(a, ws, starts, ends, ratio, min_cue):
    """SubtitleAligner.lagCurve, by FFT correlation (same numbers, ~15x faster than per-lag sums)."""
    n = len(a)
    S, E = (starts * ratio - ws) / F, (ends * ratio - ws) / F
    k = (E > S) & (E > -MAXLAG) & (S < n + MAXLAG)
    if not k.any():
        return None
    L = n + 2 * MAXLAG  # mask index j <-> clip frame j - MAXLAG
    mask = np.zeros(L + 1)
    np.add.at(mask, np.clip(np.floor(S[k] + 0.5).astype(np.int64) + MAXLAG, 0, L), 1)
    np.add.at(mask, np.clip(np.floor(E[k] + 0.5).astype(np.int64) + MAXLAG, 0, L), -1)
    mask = (np.cumsum(mask)[:L] > 0).astype(float)  # merged intervals
    size = 1 << int(np.ceil(np.log2(L + n)))
    fm = np.conj(np.fft.rfft(mask, size))
    d = (np.arange(-MAXLAG, MAXLAG + 1) - MAXLAG) % size
    si = np.fft.irfft(fm * np.fft.rfft(a, size), size)[d]
    ni = np.rint(np.fft.irfft(fm * np.fft.rfft(np.ones(n), size), size)[d])
    with np.errstate(divide='ignore', invalid='ignore'):
        sc = si / ni - (a.sum() - si) / (n - ni)
    sc[(ni < round(min_cue / F)) | (n - ni < round(min_cue / F))] = np.nan
    fin = np.sort(sc[~np.isnan(sc)])
    if len(fin) < len(sc) // 2:
        return None
    med = fin[len(fin) // 2]; sig = 1.4826 * np.sort(np.abs(fin - med))[len(fin) // 2]
    return None if sig <= 0 else np.nan_to_num((sc - med) / sig)


def clip_curve(sigs, i0, n, starts, ends, q):
    """SubtitleAligner.clipCurve: each signal's curve, averaged (they hear the same dialogue)."""
    cs = []
    for sig, clamp in sigs:
        lv = sig[i0:i0 + n]
        a = standardised(lv, clamp) if len(lv) == n else None
        c = None if a is None else lag_curve(a, i0 * F, starts, ends, q, n * F / 15)
        if c is not None: cs.append(c)
    return np.mean(cs, 0) if cs else None


def solve(cur, idx):
    best = None
    for q, per in cur.items():
        ps = [per[i] for i in idx if per[i] is not None]
        if len(ps) < 2: continue
        tot = np.sum(ps, 0) / np.sqrt(len(ps))
        p = GUARD + int(np.argmax(tot[GUARD:-GUARD]))
        rv = tot[np.abs(np.arange(len(tot)) - p) > GUARD].max()
        L, R = tot[p - 1], tot[p + 1]; c2 = L - 2 * tot[p] + R
        frac = float(np.clip(0.5 * (L - R) / c2, -.5, .5)) if c2 < 0 else 0.0
        if best is None or tot[p] > best[2]:
            best = (q, (p - MAXLAG + frac) * F, float(tot[p]), float(rv / tot[p]), p)
    return best


def at(c, p):
    return float(c[max(0, p - 3):p + 4].max())


def align(sigs, starts, ends, pos, half=False):
    """SubtitleAligner.align: (ratio, delay, peak z) to apply, or None. [half]: every other clip only."""
    clips = choose_clips(starts, ends)
    if half: clips = clips[::2]
    if len(clips) < 2:
        return None
    n = round(CLIP_S / F)
    i0s = [int(round(t / F)) for t in clips]
    cur = {q: [clip_curve(sigs, i0, n, starts, ends, q) for i0 in i0s] for q in RATIOS}
    centre = lambda i: clips[i] + CLIP_S / 2
    every = list(range(len(clips)))
    A = solve(cur, every)
    if A is None: return None
    dis = [i for i in every if (c := cur[A[0]][i]) is not None
           and c.max() >= DISAGREE_Z and abs(int(np.argmax(c)) - A[4]) > 50 and at(c, A[4]) < SUPPORT_Z]
    r, keep = A, every
    if dis:  # two camps? each clip votes for the answer it backs more; one switch = an edit
        B = solve(cur, dis) if len(dis) >= 2 else None
        if B is None: return None
        vote = []
        for i in every:
            va = at(cur[A[0]][i], A[4]) if cur[A[0]][i] is not None else 0
            vb = at(cur[B[0]][i], B[4]) if cur[B[0]][i] is not None else 0
            vote.append(None if max(va, vb) < SUPPORT_Z else va >= vb)
        voters = [i for i in every if vote[i] is not None]
        if sum(vote[x] != vote[y] for x, y in zip(voters, voters[1:])) != 1: return None
        near = min(voters, key=lambda i: abs(centre(i) - pos))
        side = A if vote[near] else B
        others = [i for i in voters if vote[i] != vote[near]]
        keep = [i for i in every if i < others[0]] if near < others[0] else [i for i in every if i > others[-1]]
        r = solve(cur, keep)
        if r is None or r[0] != side[0] or abs(r[1] - side[1]) > 0.3: return None
    q, d, z, run, p = r
    if z < MIN_Z or run > MAX_RUNNER or (q != 1.0 and z < MIN_Z + RATIO_EXTRA_Z): return None
    near = sorted((i for i in keep if cur[q][i] is not None), key=lambda i: abs(centre(i) - pos))[:2]
    if not any(at(cur[q][i], p) >= SUPPORT_Z for i in near): return None
    if q != 1.0 and not all(tight(cur[q][i], p) for i in keep if cur[q][i] is not None): return None
    return q, d, z


def both(sigs, starts, ends, pos):
    """The 8-clip answer and the 4-clip one, for the early-stop table."""
    return align(sigs, starts, ends, pos), align(sigs, starts, ends, pos, half=True)


def tight(c, p):
    """A clip's sharpest peak near p is on p: a ratio answer fits every clip, a step faked as a drift misses its ends."""
    lo = max(0, p - 150); lp = lo + int(np.argmax(c[lo:p + 151]))
    return c[lp] < TIGHT_Z or abs(lp - p) <= TIGHT_FRAMES


def run(job):
    name, others = job
    energy = levels(name)
    sigs = [(energy, True)] + ([] if ENERGY_ONLY else [(yamnet_speech(name, len(energy)), False)])
    S, E = speech_cues(name); dur = len(energy) * F
    rows = [('shift', d, dur, *both(sigs, S - d, E - d, dur / 2)) for d in DELAYS]  # subtitle d s early: fix is +d
    rows += [(tag, q, dur, *both(sigs, S / q, E / q, dur / 2)) for tag, q in DRIFTS.items()]  # media = subtitle * q
    rows += [('unrelated', None, dur, *both(sigs, o[0], o[1], dur / 2)) for o in others]
    for d2 in EDITS:
        sh = np.where(S < dur / 2, 0.0, d2)
        rows += [('edit', (d2, f), dur, *both(sigs, S - sh, E - sh, f * dur)) for f in (0.25, 0.75)]
    print(f'{name}: {len(rows)} trials', flush=True)
    return rows


def main():
    names = sorted(f[:-4] for f in os.listdir(FILMS) if f.endswith('.srt') and os.path.exists(os.path.join(FILMS, f[:-4] + '.sounds')))
    for n in names:
        levels(n)  # extract one at a time, before the pool: ffmpeg per film is the RAM peak
    cues = [speech_cues(n) for n in names]
    pool = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8
    with Pool(pool) as p:
        rows = [r for rs in p.map(run, [(n, [c for j, c in enumerate(cues) if j != i]) for i, n in enumerate(names)]) for r in rs]
    report(rows)
    # Stop after 4 clips when their peak is at least T, else decode all 8 (SubtitleSyncModule).
    for T in (8, 10, 12, 15, 20):
        staged = [r[:3] + ((r[4] if r[4] and r[4][2] >= T else r[3]),) for r in rows]
        early = sum(1 for r in rows if r[4] and r[4][2] >= T)
        print(f'\n--- stop at 4 clips when z >= {T}: stopped early {early}/{len(rows)}')
        report(staged)


def report(rows):
    sh = [r for r in rows if r[0] == 'shift']
    err = [abs(r[3][1] - r[1]) for r in sh if r[3] and r[3][0] == 1.0]
    right = [e for e in err if e <= 0.3]
    print(f'\n{"energy only" if ENERGY_ONLY else "energy + YAMNet"}')
    print(f'shifted ({len(sh)}): right {100 * len(right) / len(sh):.1f}%, median {1000 * np.median(right):.0f} ms, '
          f'wrong {sum(1 for r in sh if r[3]) - len(right)}, refused {sum(1 for r in sh if not r[3])}')
    for tag, q in DRIFTS.items():
        dr = [r for r in rows if r[0] == tag]
        T = lambda r: np.array([0.1, 0.5, 0.9]) * r[2]
        ok = sum(1 for r in dr if r[3] and np.abs(T(r) / q * r[3][0] + r[3][1] - T(r)).max() <= 0.3)
        print(f'{tag:10s} ({len(dr)}): right {ok}, wrong {sum(1 for r in dr if r[3]) - ok}, refused {sum(1 for r in dr if not r[3])}')
    un = [r for r in rows if r[0] == 'unrelated']
    print(f'unrelated ({len(un)}): applied {sum(1 for r in un if r[3])}')
    ed = [r for r in rows if r[0] == 'edit']
    ok = lambda r: r[3] and r[3][0] == 1.0 and abs(r[3][1] - (0 if r[1][1] < 0.5 else r[1][0])) <= 0.3
    print(f'mid-film edit ({len(ed)}): viewer side right {sum(1 for r in ed if ok(r))}, '
          f'wrong {sum(1 for r in ed if r[3] and not ok(r))}, refused {sum(1 for r in ed if not r[3])}')


if __name__ == '__main__':
    main()
