"""
Subtitle sync for the haptics fixtures (docs/haptics-decisions.md, Spider-Man): how far a subtitle
is off its film, by its dialogue lines against YAMNet's Speech score in <name>.sounds. Films in
sync read -0.1 to +0.2 s; shift a subtitle by the difference before using it.

Run: .haptics-fixtures/venv/Scripts/python -I scripts/haptics-subsync.py <name>.sounds <name>.srt
"""
import re, struct, sys
import numpy as np
raw = open(sys.argv[1], 'rb').read()
n = struct.unpack('>i', raw[:4])[0]
speech = np.frombuffer(raw[4:4 + n * 521], dtype=np.uint8).reshape(n, 521)[:, 0] / 255.0
t = open(sys.argv[2], encoding='utf-8-sig', errors='replace').read().replace('\r', '')
spans = []
for b in re.split(r'\n\n+', t):
    m = re.search(r'(\d+):(\d+):(\d+)[,.](\d+) --> (\d+):(\d+):(\d+)[,.](\d+)', b)
    if not m: continue
    txt = re.sub(r'\[[^]]*\]|\([^)]*\)|<[^>]*>|♪', '', ' '.join(b.split('\n')[2:])).strip()
    if len(txt) < 3: continue  # sound tags only
    g = list(map(int, m.groups()))
    a, e = (g[0]*3600 + g[1]*60 + g[2]) + g[3]/1000, (g[4]*3600 + g[5]*60 + g[6]) + g[7]/1000
    spans.append((a, e))
# Share of each window [0.48k, 0.48k + 0.975) under a line, the subtitles moved by o seconds.
mid = np.arange(n) * 0.48
def r(o):
    cover = np.zeros(n)
    for a, e in spans:
        lo, hi = max(0, int((a + o - 0.975) / 0.48)), min(n, int((e + o) / 0.48) + 1)
        w = mid[lo:hi]
        cover[lo:hi] += np.clip(np.minimum(w + 0.975, e + o) - np.maximum(w, a + o), 0, None) / 0.975
    return np.corrcoef(cover, speech)[0, 1]
best = max((r(o / 10), o / 10) for o in range(-20, 21))
print('subtitles fit best moved %+.1f s (r %.4f)' % (best[1], best[0]))
