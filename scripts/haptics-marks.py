"""
Testers' haptics marks (docs/haptics-decisions.md, Marks): pulls the phone's "Too much" / "Missed"
marks (film file name, media ms, kind) and adds the new ones to .haptics-fixtures/marks.tsv, where
HapticBenchTest reports each as a case. The phone keeps its file; lines already here are skipped.

Run: python -I scripts/haptics-marks.py [adb serial]
"""
import os, subprocess, sys
PHONE = '/sdcard/Android/data/com.glide.player/files/haptics-marks.tsv'
OUT = os.path.join(os.path.dirname(__file__), '..', '.haptics-fixtures', 'marks.tsv')
serial = ['-s', sys.argv[1]] if len(sys.argv) > 1 else []
env = dict(os.environ, MSYS_NO_PATHCONV='1')
pulled = subprocess.run(['adb', *serial, 'exec-out', 'cat', PHONE], capture_output=True, env=env, check=True).stdout.decode('utf-8')
have = open(OUT, encoding='utf-8').read().splitlines() if os.path.exists(OUT) else []
new = [l for l in pulled.splitlines() if l.count('\t') == 2 and l not in have]
with open(OUT, 'a', encoding='utf-8', newline='\n') as f:
    f.writelines(l + '\n' for l in new)
print(f'{len(new)} new marks, {len(have) + len(new)} in {os.path.normpath(OUT)}')
for l in new: print('  ' + l)
