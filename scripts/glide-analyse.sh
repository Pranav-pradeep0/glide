#!/bin/sh
# The haptics judge (docs/haptics-decisions.md, Judge): adds any films given, then judges every film
# in .haptics-fixtures/films and writes .haptics-fixtures/report/index.html.
#
#   scripts/glide-analyse.sh                                  judge the films already added
#   scripts/glide-analyse.sh film.mkv phone:/sdcard/Download/1DMP/Videos/x.mkv
#                                                             add these first (phone: pulls over adb,
#                                                             then deletes the pulled video)
# Ingest options go through HAPTICS_INGEST, e.g. HAPTICS_INGEST="--name boys-s05e05".
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IN="$ROOT/.haptics-fixtures/incoming"
for v in "$@"; do
    case "$v" in
        phone:*)
            mkdir -p "$IN"
            f="$IN/$(basename "${v#phone:}")"
            echo "pulling ${v#phone:}"
            MSYS_NO_PATHCONV=1 adb pull "${v#phone:}" "$(cygpath -w "$f" 2>/dev/null || echo "$f")"
            python -I "$ROOT/scripts/haptics-ingest.py" "$f" --scenes $HAPTICS_INGEST
            rm -f "$f" ;;
        *) python -I "$ROOT/scripts/haptics-ingest.py" "$v" --scenes $HAPTICS_INGEST ;;
    esac
done
cd "$ROOT/android"
./gradlew -q :app:testDebugUnitTest --tests "com.glide.app.haptic.HapticJudgeTest" --rerun
python -I -c "
import re, html, sys
s = open(sys.argv[1], encoding='utf-8').read()
print(html.unescape(re.search(r'<system-out><!\[CDATA\[(.*?)\]\]>', s, re.S).group(1)).rstrip())" \
    app/build/test-results/testDebugUnitTest/TEST-com.glide.app.haptic.HapticJudgeTest.xml
