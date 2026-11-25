#!/bin/bash
# The sound lab on this Mac, without the GPU machine: serves web/ and opens the page in Chrome.
#   ./sound-lab.sh          (Ctrl-C to stop)
cd "$(dirname "$0")/web" || { echo "can't find the web folder next to this script"; exit 1; }
[ -f sound-lab.html ] || { echo "sound-lab.html isn't here: pull the latest in GitHub Desktop"; exit 1; }
command -v python3 >/dev/null || { echo "python3 isn't installed (xcode-select --install)"; exit 1; }
PORT=8010
while lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT + 1)); done      # (a port that's free)
URL="http://localhost:$PORT/sound-lab.html"
echo "Sound lab: $URL   (Ctrl-C to stop)"
( sleep 1; open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL" ) &
exec python3 -m http.server $PORT --bind 127.0.0.1
