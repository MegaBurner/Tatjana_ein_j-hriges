#!/bin/zsh
# Headless-Screenshot für die visuelle Verifikation — CPU-schonend und
# selbstaufräumend. Ersetzt die Ad-hoc-Chrome-Aufrufe der Agent-Sessions.
#
# Usage: scripts/shot.sh <url> <out.png> [breite] [hoehe]
# Beispiel: scripts/shot.sh "http://localhost:5173/Tatjana_ein_j-hriges/?section=5" /tmp/s5.png
set -u

URL="${1:?Usage: shot.sh <url> <out.png> [breite] [hoehe]}"
OUT="${2:?Usage: shot.sh <url> <out.png> [breite] [hoehe]}"
WIDTH="${3:-1280}"
HEIGHT="${4:-900}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HARD_TIMEOUT_S=60

# Verifikations-Params ergänzen, falls der Aufrufer sie nicht selbst setzt:
# freeze=1 stoppt den R3F-Render-Loop, sobald die Szene steht (Experience.tsx).
for p in freeze=1 nointro=1 instant=1; do
  case "$URL" in
    *"${p%%=*}="*) ;;
    *"?"*) URL="$URL&$p" ;;
    *) URL="$URL?$p" ;;
  esac
done

# --enable-unsafe-swiftshader ist für Software-WebGL unter --disable-gpu nötig.
# Bewusst OHNE --disable-gpu-vsync/--disable-frame-rate-limit: die lassen
# SwiftShader ungebremst auf der CPU rendern (~2,5 Kerne pro Screenshot).
"$CHROME" --headless=new --disable-gpu --enable-unsafe-swiftshader \
  --hide-scrollbars --window-size="${WIDTH},${HEIGHT}" \
  --virtual-time-budget=15000 --screenshot="$OUT" "$URL" >/dev/null 2>&1 &
CHROME_PID=$!

# macOS hat kein `timeout`; Chrome-Instanzen hingen schon mal 45+ Minuten.
( sleep "$HARD_TIMEOUT_S"; kill -9 "$CHROME_PID" 2>/dev/null ) &
WATCHDOG_PID=$!

wait "$CHROME_PID"
CHROME_RC=$?
kill "$WATCHDOG_PID" 2>/dev/null

if [ ! -s "$OUT" ]; then
  echo "shot.sh: Screenshot fehlgeschlagen (Chrome-Exit $CHROME_RC): $OUT" >&2
  exit 1
fi
echo "$OUT"
