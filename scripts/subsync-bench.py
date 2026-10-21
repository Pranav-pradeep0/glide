"""
Auto subtitle sync benchmark on the haptics fixture films: a Python port of SubtitleAligner.kt and
SubtitleAutoSync.ts (speech cues, 5-minute window, energy first, YAMNet Speech fallback, frame-rate
ratio confirmed in a second window). Each film's subtitle in .haptics-fixtures/films is in sync
(-0.1 to +0.2 s); it is shifted by known delays, retimed for other frame rates, or swapped for another
film's, then scored: applied & right (|err| <= 0.3 s, ratio mapping within 0.3 s at 10/50/90% of the film),
gross (> 0.5 s or wrong ratio), refused. Speech-band loudness (as the phone meters it) is cached next to
each film as <name>.levels.npy; needs ffmpeg on PATH and <name>.sounds from haptics-yamnet.py.

Run: .haptics-fixtures/venv/Scripts/python -I scripts/subsync-bench.py [pool size, default 4]
"""
import os, re, struct, subprocess, sys
os.environ['OPENBLAS_NUM_THREADS'] = os.environ['OMP_NUM_THREADS'] = '1'
from multiprocessing import Pool
import numpy as np

FILMS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.haptics-fixtures', 'films')
F, MAX_SHIFT = 0.01, 60.0
MAXLAG = round(MAX_SHIFT / F)
RATIOS = [1.0, 25 / 23.976, 23.976 / 25, 25 / 24, 24 / 25, 24 / 23.976, 23.976 / 24]
MIN_Z, MAX_RUNNER, GUARD, AGREE_MIN_Z, AGREE_TOL, DETREND, MIN_CUE = 6.0, 0.75, 100, 2.0, 0.25, 8.0, 20.0
WINDOW_S, AROUND_S, MIN_SPEECH, MAX_CUE_S = 300, 900, 25, 12
RATIO_AGREE_S, MIN_APART_S = 0.4, 1200
DELAYS = [0, 0.8, -2.3, 6.7, -18.4, 41.2]
DRIFTS = {'25/23.976': 25 / 23.976, '23.976/25': 23.976 / 25, '25/24': 25 / 24, '24/23.976': 24 / 23.976}
NW = round(WINDOW_S / F)


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


def densest(starts, ends, keep):
    """Start of the WINDOW_S stretch with the most cues among starts keep() accepts (closest wins ties)."""
    best, hi = None, 0
    for lo in range(len(starts)):
        start = max(0.0, starts[lo] - 20)
        hi = max(hi, lo)
        while hi < len(starts) and ends[hi] <= start + WINDOW_S:
            hi += 1
        if (rank := keep(start)) is not None and (best is None or (hi - lo, -rank) > (best[1], -best[2])):
            best = (start, hi - lo, rank)
    return best[0] if best and best[1] >= MIN_SPEECH else None


def standardised(lv, clip):
    a = np.clip(lv, -80, 0).astype(np.float64) if clip else lv.astype(np.float64)
    p = np.concatenate([[0], np.cumsum(a)]); half = round(DETREND / 2 / F); i = np.arange(len(a))
    lo, hi = np.maximum(0, i - half), np.minimum(len(a), i + half + 1)
    d = a - (p[hi] - p[lo]) / (hi - lo)
    return None if d.std() < 1e-6 else (d - d.mean()) / d.std()


def prefix(a, f, t):
    return np.concatenate([[0], np.cumsum(a[f:t])])


def align_at(pre, ws, starts, ends, ratio, min_cue=MIN_CUE):
    """Mean level inside the cues minus outside, at every lag; the peak as a robust z-score."""
    n = len(pre) - 1
    S, E = (starts * ratio - ws) / F, (ends * ratio - ws) / F
    k = (E > S) & (E > -MAXLAG) & (S < n + MAXLAG)
    if not k.any():
        return None
    merged = []
    for s, e in sorted(zip(S[k], E[k])):
        if merged and s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    iv, lags = np.array(merged), np.arange(-MAXLAG, MAXLAG + 1)
    sum_in, n_in = np.empty(len(lags)), np.empty(len(lags), np.int64)
    for c in range(0, len(lags), 1000):  # chunked: the lag x cue matrices stay small
        L = lags[c:c + 1000]
        lo = np.clip(np.floor(iv[:, :1] + L + 0.5).astype(np.int64), 0, n); hi = np.clip(np.floor(iv[:, 1:] + L + 0.5).astype(np.int64), 0, n)
        ok = hi > lo
        sum_in[c:c + 1000] = np.where(ok, pre[hi] - pre[lo], 0).sum(0); n_in[c:c + 1000] = np.where(ok, hi - lo, 0).sum(0)
    with np.errstate(divide='ignore', invalid='ignore'):
        sc = sum_in / n_in - (pre[n] - sum_in) / (n - n_in)
    sc[(n_in < round(min_cue / F)) | (n - n_in < round(min_cue / F))] = np.nan
    fin = np.sort(sc[~np.isnan(sc)])
    inner = sc[GUARD:len(sc) - GUARD]
    if len(fin) < len(sc) // 2 or np.all(np.isnan(inner)):
        return None
    med = fin[len(fin) // 2]; sigma = 1.4826 * np.sort(np.abs(fin - med))[len(fin) // 2]
    peak = GUARD + int(np.nanargmax(inner))
    rv = sc[(np.abs(np.arange(len(sc)) - peak) > GUARD) & ~np.isnan(sc)]
    height = sc[peak] - med
    if sigma <= 0 or height <= 0:
        return None
    L = sc[peak - 1] if not np.isnan(sc[peak - 1]) else sc[peak]
    R = sc[peak + 1] if not np.isnan(sc[peak + 1]) else sc[peak]
    cur = L - 2 * sc[peak] + R
    frac = float(np.clip(0.5 * (L - R) / cur, -0.5, 0.5)) if cur < 0 else 0.0
    return dict(delay=(peak - MAXLAG + frac) * F, ratio=ratio, z=height / sigma,
                runner=((rv.max() if len(rv) else med) - med) / height, agreed=False)


def confident(r):
    return r is not None and (r['agreed'] or (r['z'] >= MIN_Z and r['runner'] <= MAX_RUNNER))


def align(lv, ws, starts, ends, clip):
    """SubtitleAligner.align: plain delay; else two half-windows agreeing; else the best frame-rate ratio."""
    a = None if len(lv) < 2 * MAXLAG else standardised(lv, clip)
    if a is None:
        return None
    pre = prefix(a, 0, len(a))
    plain = align_at(pre, ws, starts, ends, 1.0)
    if confident(plain):
        return plain
    if plain is not None and plain['z'] >= AGREE_MIN_Z:
        half = len(a) // 2
        halves = [align_at(prefix(a, f, f + half), ws + f * F, starts, ends, 1.0, MIN_CUE / 2) for f in (0, half)]
        if all(r is not None and abs(r['delay'] - plain['delay']) <= AGREE_TOL for r in halves):
            return dict(plain, agreed=True)
    cands = [r for r in [plain] + [align_at(pre, ws, starts, ends, q) for q in RATIOS[1:]] if r]
    return max(cands, key=lambda r: r['z']) if cands else None


def halves_agree(lv, ws, starts, ends, r):
    a = standardised(lv, False); half = len(a) // 2
    rs = [align_at(prefix(a, f, f + half), ws + f * F, starts, ends, 1.0, MIN_CUE / 2) for f in (0, half)]
    return all(x is not None and abs(x['delay'] - r['delay']) <= AGREE_TOL for x in rs)


def cut(sig, t):
    i0 = int(np.clip(np.floor(t / F + 0.5), 0, max(0, len(sig) - NW)))
    return sig[i0:i0 + NW], i0 * F


def sync(energy, yam, starts, ends, pos):
    """The app's decision: (ratio, delay) to apply, 'drift' (refused, ratio unconfirmed), or None (refused)."""
    ws = densest(starts, ends, lambda s: abs(s - pos) if abs(s - pos) <= AROUND_S else None)
    if ws is None:
        return None, False
    for sig, clip in ((energy, True), (yam, False)):
        lv, ws = cut(sig, ws)
        r = align(lv, ws, starts, ends, clip)
        # SubtitleAligner.halvesConfirm: a plain YAMNet delay must also be found by each half alone.
        if confident(r) and (clip or r['ratio'] != 1.0 or r['agreed'] or halves_agree(lv, ws, starts, ends, r)):
            break
    else:
        return None, False
    if r['ratio'] == 1.0:
        return (1.0, r['delay']), False
    wb = densest(starts, ends, lambda s: 0 if abs(s - ws) >= MIN_APART_S else None)
    if wb is None:
        return None, True
    pa = prefix(standardised(lv, clip), 0, NW)
    lvb, wb = cut(sig, wb)
    sb = standardised(lvb, clip)
    if sb is None:
        return None, False
    pb, best = prefix(sb, 0, len(sb)), None
    for q in RATIOS[1:]:
        a, b = align_at(pa, ws, starts, ends, q), align_at(pb, wb, starts, ends, q)
        if (a and b and min(a['z'], b['z']) >= AGREE_MIN_Z and max(a['runner'], b['runner']) <= MAX_RUNNER
                and abs(a['delay'] - b['delay']) <= RATIO_AGREE_S):
            if best is None or min(a['z'], b['z']) > best[0]:
                best = (min(a['z'], b['z']), q, a['delay'])
    return (best[1:] if best else None), False


def run(job):
    name, other = job
    energy = levels(name); yam = yamnet_speech(name, len(energy))
    S, E = speech_cues(name); dur = len(energy) * F
    rows = []
    for pos in np.arange(300, dur - 600, 600):
        for d in DELAYS:  # subtitle d s early: the fix is +d
            rows.append((name, 'shift', d, 1.0, dur) + sync(energy, yam, S - d, E - d, pos))
        for tag, q in DRIFTS.items():  # timed for another frame rate: media = subtitle * q
            rows.append((name, tag, 0.0, q, dur) + sync(energy, yam, S / q, E / q, pos / q))
        rows.append((name, 'unrelated', None, None, dur) + sync(energy, yam, other[0], other[1], pos))
    print(f'{name}: {len(rows)} trials', flush=True)
    return rows


def main():
    names = sorted(f[:-4] for f in os.listdir(FILMS) if f.endswith('.srt') and os.path.exists(os.path.join(FILMS, f[:-4] + '.sounds')))
    for n in names:
        levels(n)  # extract one at a time, before the pool: ffmpeg per film is the RAM peak
    cues = [speech_cues(n) for n in names]
    with Pool(int(sys.argv[1]) if len(sys.argv) > 1 else 4, maxtasksperchild=1) as p:
        rows = [r for rs in p.map(run, [(n, cues[(i + 1) % len(names)]) for i, n in enumerate(names)]) for r in rs]
    sh = [r for r in rows if r[1] == 'shift']
    err = [abs(r[5][1] - r[2]) for r in sh if r[5] and r[5][0] == 1.0]
    right = [e for e in err if e <= 0.3]
    print(f'\nshifted ({len(sh)}): right {100 * len(right) / len(sh):.1f}%, median {1000 * np.median(right):.0f} ms, '
          f'gross {sum(e > 0.5 for e in err) + sum(1 for r in sh if r[5] and r[5][0] != 1.0)}, '
          f'ratio != 1 {sum(1 for r in sh if r[5] and r[5][0] != 1.0)}, refused {sum(1 for r in sh if not r[5])}')
    for tag, q in DRIFTS.items():
        dr = [r for r in rows if r[1] == tag]
        T = lambda r: np.array([0.1, 0.5, 0.9]) * r[4]
        ok = sum(1 for r in dr if r[5] and np.abs(T(r) / q * r[5][0] + r[5][1] - T(r)).max() <= 0.3)
        print(f'{tag:10s} ({len(dr)}): exact ratio {sum(1 for r in dr if r[5] and r[5][0] == q)}, mapping within 0.3 s {ok}, '
              f'wrong ratio {sum(1 for r in dr if r[5] and r[5][0] not in (q, 1.0))}, plain delay {sum(1 for r in dr if r[5] and r[5][0] == 1.0)}, '
              f'drift refused for want of a second window {sum(1 for r in dr if r[6])}')
    un = [r for r in rows if r[1] == 'unrelated']
    print(f'unrelated ({len(un)}): applied {sum(1 for r in un if r[5])}')


if __name__ == '__main__':
    main()
