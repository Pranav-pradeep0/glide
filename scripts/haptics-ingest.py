"""
Adds a film to the haptics test set (docs/haptics-decisions.md, Judge): its English audio as
.haptics-fixtures/films/<name>.mka, its SDH subtitles as <name>.srt (the file's own SDH track,
--srt, or SubDL's with SUBDL_API_KEY set), YAMNet's scores as <name>.sounds, the subtitles moved
onto the dialogue, and with --scenes the scene cuts as <name>.scenes. Then
scripts/glide-analyse.sh judges it with the others.

Run: python -I scripts/haptics-ingest.py <video> [--name boys-s05e04] [--srt file.srt] [--scenes]
Names: lowercase title, a series' episodes as <title>-s01e01 (held out together).
"""
import argparse, io, json, os, re, shutil, subprocess, sys, urllib.parse, urllib.request, zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FILMS = os.path.join(ROOT, '.haptics-fixtures', 'films')
PY = os.path.join(ROOT, '.haptics-fixtures', 'venv', 'Scripts', 'python')
ENGLISH = {'eng', 'en', 'english'}
SDH = re.compile(r'sdh|hearing|\bhi\b|\bcc\b', re.I)

a = argparse.ArgumentParser()
a.add_argument('video')
a.add_argument('--name')
a.add_argument('--srt')
a.add_argument('--scenes', action='store_true', help='find scene cuts (decodes the whole video: minutes)')
args = a.parse_args()
base = os.path.splitext(os.path.basename(args.video))[0]
name = args.name or re.sub(r'[^a-z0-9]+', '', re.split(r'[.\s_](19|20)\d\d|[.\s_]\d{3,4}p', base.lower())[0])
out = lambda ext: os.path.join(FILMS, name + ext)
os.makedirs(FILMS, exist_ok=True)

def run(*cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode: sys.exit(f'{cmd[0]} failed: {r.stderr[-800:]}')
    return r

streams = json.loads(run('ffprobe', '-v', 'error', '-show_streams', '-of', 'json', args.video).stdout)['streams']
lang = lambda s: s.get('tags', {}).get('language', '').lower()
title = lambda s: s.get('tags', {}).get('title', '')

# Audio: English, the most channels (5.1 gives the bench its subwoofer).
audio = [s for s in streams if s['codec_type'] == 'audio']
if not audio: sys.exit('no audio track')
pick = max(audio, key=lambda s: (lang(s) in ENGLISH, s.get('channels', 0)))
print(f"{name}: audio track {pick['index']} ({lang(pick) or '?'}, {pick.get('channels')} ch)")
if not os.path.exists(out('.mka')):
    run('ffmpeg', '-v', 'error', '-i', args.video, '-map', f"0:{pick['index']}", '-c', 'copy', out('.mka'))

# Subtitles: given, the file's own SDH track, or SubDL's hearing-impaired one.
if args.srt:
    shutil.copy(args.srt, out('.srt'))
elif not os.path.exists(out('.srt')):
    text = [s for s in streams if s['codec_type'] == 'subtitle' and lang(s) in ENGLISH and s.get('codec_name') in ('subrip', 'ass', 'mov_text', 'webvtt')]
    own = [s for s in text if SDH.search(title(s)) or s.get('disposition', {}).get('hearing_impaired')]
    if own:
        print(f"{name}: SDH subtitles from the file (track {own[0]['index']}, {title(own[0]) or 'untitled'})")
        run('ffmpeg', '-v', 'error', '-i', args.video, '-map', f"0:{own[0]['index']}", '-c:s', 'srt', out('.srt'))
    elif os.environ.get('SUBDL_API_KEY'):
        q = urllib.parse.urlencode({'api_key': os.environ['SUBDL_API_KEY'], 'film_name': re.sub(r'[._]', ' ', base), 'languages': 'EN', 'hi': 1})
        found = json.load(urllib.request.urlopen('https://api.subdl.com/api/v1/subtitles?' + q)).get('subtitles') or []
        hi = [s for s in found if s.get('hi')] or found
        if not hi: sys.exit(f'{name}: no SDH subtitles on SubDL; pass one with --srt')
        z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen('https://dl.subdl.com' + hi[0]['url']).read()))
        srt = next(n for n in z.namelist() if n.lower().endswith('.srt'))
        open(out('.srt'), 'wb').write(z.read(srt))
        print(f"{name}: SDH subtitles from SubDL ({hi[0].get('release_name', srt)})")
    else:
        sys.exit(f'{name}: no SDH track in the file; pass one with --srt, or set SUBDL_API_KEY')

# YAMNet, then the subtitles moved onto the dialogue it hears.
if not os.path.exists(out('.sounds')):
    print(f'{name}: sound recognition (a few minutes)')
    subprocess.run([PY, '-I', os.path.join(ROOT, 'scripts', 'haptics-yamnet.py'), name], check=True)
fit = run(PY, '-I', os.path.join(ROOT, 'scripts', 'haptics-subsync.py'), out('.sounds'), out('.srt')).stdout.strip()
print(f'{name}: {fit}')
m = re.search(r'moved ([+-][\d.]+) s \(r ([-\d.]+)\)', fit)
shift, r = float(m.group(1)), float(m.group(2))
# Films in sync fit at -0.1 to +0.2 s with r 0.4-0.6; a weak fit or one at the 2 s edge moves nothing.
if r < 0.3 or abs(shift) >= 2:
    print(f'{name}: the fit is unsure (r {r:.2f}, {shift:+.1f} s): subtitles left as they are; check them')
elif abs(shift) >= 0.2:
    def moved(m):
        t = max(0, round((int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3])) * 1000 + int(m[4]) + shift * 1000))
        return '%02d:%02d:%02d,%03d' % (t // 3600000, t // 60000 % 60, t // 1000 % 60, t % 1000)
    t = open(out('.srt'), encoding='utf-8-sig', errors='replace').read()
    open(out('.srt'), 'w', encoding='utf-8').write(re.sub(r'(\d+):(\d+):(\d+)[,.](\d+)', moved, t))
    print(f'{name}: subtitles moved {shift:+.1f} s')

# Scene cuts, for the report.
if args.scenes and any(s['codec_type'] == 'video' for s in streams) and not os.path.exists(out('.scenes')):
    print(f'{name}: scene cuts (decodes the whole video)')
    r = run('ffmpeg', '-v', 'info', '-i', args.video, '-map', '0:v:0', '-vf', "scale=320:-2,select='gt(scene,0.35)',showinfo", '-f', 'null', '-')
    cuts = re.findall(r'pts_time:([\d.]+)', r.stderr)
    open(out('.scenes'), 'w').write('\n'.join(cuts) + '\n')
    print(f'{name}: {len(cuts)} scene cuts')
print(f'{name}: ready. Run scripts/glide-analyse.sh')
