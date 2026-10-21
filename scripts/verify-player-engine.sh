#!/usr/bin/env bash
#
# Device verification for the Media3/ExoPlayer engine, phases 1-3.
# See docs/player-engine-migration-plan.md section 3.1 for the protocol this implements.
#
#   bash scripts/verify-player-engine.sh "/sdcard/path/to/hdr.mkv"
#
# Assumes: debug build installed, Metro running, "Experimental Player Engine" ON in
# Settings -> Playback, and the phone left alone for the duration -- a stray touch has
# already produced one false result in this migration.
#
# Every check below states the line that would appear if it were BROKEN, because a check
# that cannot fail is not a check.
set -u

URI="${1:-}"
if [ -z "$URI" ]; then
  echo "usage: $0 <absolute /sdcard path to an HDR test file>" >&2
  exit 2
fi

PKG=com.glide.player
OUT="${TMPDIR:-/tmp}/glide-verify"
mkdir -p "$OUT"

say() { printf '\n=== %s ===\n' "$*"; }
launch() {
  adb shell am force-stop "$PKG"
  adb logcat -c
  adb shell "am start -a android.intent.action.VIEW -d '$1' -t 'video/*' -n $PKG/.VideoPlayerActivity" >/dev/null
}
# The log buffer is small and this app is chatty; the first 15s were evicted once already.
adb logcat -G 32M >/dev/null 2>&1

say "1. open, resume, tracks, load"
launch "$URI"
adb shell sleep 22
adb logcat -d -v time > "$OUT/open.log"
grep -E "W/GlidePlayer|E/GlidePlayer" "$OUT/open.log" | sed 's/^[0-9-]* //' | head -14
echo "-- BROKEN would be: no 'load duration=' line; 'player error'; 'seek dropped';"
echo "   startPositionMs=<n> followed by a seek to 0 (the phantom-restart defect)."

say "2. HDR path -- the check that matters most"
adb shell dumpsys SurfaceFlinger > "$OUT/sf.txt" 2>&1
echo "colorMode: $(grep -oE 'colorMode=[A-Z0-9_]+ \([0-9]+\)' "$OUT/sf.txt" | sort -u | tr '\n' ' ')"
echo "dataspaces:"; grep -oE "dataspace=[A-Za-z0-9_]+ \([0-9]+\)" "$OUT/sf.txt" | sort | uniq -c
echo "-- PASS needs a BT2020_PQ / BT2020_ITU_PQ layer and colorMode=DISPLAY_P3."
echo "-- BROKEN is V0_SRGB only with colorMode=SRGB: HDR tone-mapped to 8-bit sRGB,"
echo "   which looks like mild washout plus grain in dark scenes. Do NOT rely on the"
echo "   decoder name or the display's '[ hdr ]' brightness reason -- both stay correct"
echo "   while the frames are being flattened downstream. This is the assertion."

say "3. audio decoder actually in use"
grep -oE "allocate\(c2\.[a-z0-9._]*\)" "$OUT/open.log" | sort -u
grep -E "Loaded Ffmpeg(Audio|Video)Renderer" "$OUT/open.log" | sed 's/^[0-9-]* //' | sort -u
echo "-- BROKEN: no FfmpegAudioRenderer line, or an eac3 track with SUPPORTED=false"
echo "   (that is the silent-playback failure mode from phase 0)."

say "4. NOW BY HAND: cycle all six resize modes, then rotate, then press play/pause."
echo "    Press enter here when done."
read -r _
adb logcat -d -v time > "$OUT/modes.log"
grep -E "W/GlidePlayer.*(resizeMode|layout|isPlaying)" "$OUT/modes.log" | sed 's/^[0-9-]* //' | tail -30
echo "-- Every 'resizeMode=' MUST be followed by a 'layout' line. A mode change with no"
echo "   layout is the requestLayout()-is-a-no-op defect returning."
echo "-- contain/scale-down fit inside the view; cover and none exceed it; fill equals it."

say "5. NOW BY HAND: enable colour enhancement, then re-check HDR."
echo "    Press enter when done."
read -r _
adb shell dumpsys SurfaceFlinger > "$OUT/sf_enh.txt" 2>&1
grep -oE "colorMode=[A-Z0-9_]+ \([0-9]+\)" "$OUT/sf_enh.txt" | sort -u
grep -oE "dataspace=[A-Za-z0-9_]+ \([0-9]+\)" "$OUT/sf_enh.txt" | sort | uniq -c
adb logcat -d -v time | grep -E "W/GlidePlayer.*(enhancement|open uri)" | sed 's/^[0-9-]* //' | tail -4
echo "-- BROKEN: 'HDR is not yet supported', ERROR_CODE_VIDEO_FRAME_PROCESSING_FAILED,"
echo "   a dataspace drop to V0_SRGB, or a re-open whose startPositionMs is 0 rather than"
echo "   the position it was at."

say "6. NOW BY HAND: enter PiP, resize it, leave it. Then check the notification and"
echo "    lock screen, then swipe the app off Recents. Press enter when done."
read -r _
adb logcat -d -v time > "$OUT/pip.log"
grep -E "GlidePip|W/GlidePlayer.*(PiP|media session)" "$OUT/pip.log" | sed 's/^[0-9-]* //' | tail -20
echo "-- BROKEN: no 'media session created'; PiP entering at the wrong aspect; playback"
echo "   pausing on PiP enter (host pause must be ignored while in PiP); a crash on task"
echo "   dismissal, which means the session outlived the player."

say "artifacts in $OUT"
