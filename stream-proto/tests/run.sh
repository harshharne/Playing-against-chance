#!/bin/bash
# The tests, in one command. Runs on the Mac (or anywhere with Python 3 and Node), with no GPU and no keys: the
# server runs as a stand-in (MOCK mode) from a temporary copy, on its own port, so nothing of yours is touched.
#   bash tests/run.sh          the quick set (~7 min): files, world clock, a life, the drills, the panel, the panel live
#   bash tests/run.sh full     the quick set + the soak (LIVES lives back to back in one page, ~2 min each; default 6)
#   bash tests/run.sh life     one test by name (files | clock | face | dice | voice | life | drills | panel | live | whom | soak)
# The first run installs what the browser tests need (Playwright and its Chromium, ~150 MB, into tests/node_modules).
cd "$(dirname "$0")" || exit 1
PY="${PYTHON:-python3}"
command -v node >/dev/null || { echo "Node isn't installed: brew install node"; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] || { echo "Node 18 or newer is needed: brew upgrade node"; exit 1; }
"$PY" -c "import fastapi, uvicorn, PIL, numpy" 2>/dev/null || { echo "The stand-in needs: $PY -m pip install fastapi \"uvicorn[standard]\" pillow numpy"; exit 1; }
if ! node -e "require.resolve('playwright')" >/dev/null 2>&1; then
  echo "· installing Playwright for the browser tests (once)"
  npm install --no-save --silent playwright >/dev/null && npx playwright install chromium >/dev/null || { echo "couldn't install Playwright"; exit 1; }
fi
cmd() {                                                   # (no associative arrays: the Mac's bash is 3.2)
  case "$1" in
    files) echo "$PY unit/check_files.py" ;;       clock) echo "node unit/worldclock.test.mjs" ;;
    face) echo "python3 unit/steady.test.py" ;;
    voice) echo "node browser/voice.test.js" ;;
    dice) echo "python3 unit/dice_table.test.py" ;;
    life) echo "node browser/life.test.js" ;;
    drills) echo "node browser/drills.test.js" ;;    panel) echo "node browser/panel.test.js" ;;
    soak) echo "node browser/soak.test.js" ;;        live) echo "node browser/live.test.js" ;;        whom) echo "node browser/whom.test.js" ;;
    *) echo "" ;;
  esac
}
QUICK="files clock face dice voice panel live whom life drills"
case "${1:-quick}" in
  quick) RUN="$QUICK" ;;
  full) RUN="$QUICK soak" ;;
  *) [ -n "$(cmd "$1")" ] || { echo "no test called $1 (files clock face dice voice life drills panel live whom soak)"; exit 1; }; RUN="$1" ;;
esac
pass=0; fail=0; failed=""
for t in $RUN; do
  echo "· $t"
  if $(cmd "$t"); then pass=$((pass + 1)); else fail=$((fail + 1)); failed="$failed $t"; fi
done
echo
if [ $fail -eq 0 ]; then echo "ALL $pass PASSED"; else echo "$fail FAILED:$failed  ($pass passed)"; exit 1; fi
