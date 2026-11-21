#!/usr/bin/env bash
# Run on your MAC, inside the stream-proto folder, after pulling in GitHub Desktop:
#     ./push.sh          sends the code (pages + server + keys) and restarts the server if it needs it
#     ./push.sh loras    also sends the LoRA files in loras/ (only needed when you add your own)
# ./show.sh on runs it for you when the code on the Mac is newer than on the machine.
set -e
VM="chance-rtx"
ZONE="asia-south1-c"
cd "$(dirname "$0")"
STATE="$HOME/.chance"; mkdir -p "$STATE"
MODE=$(cat "$STATE/ssh_mode" 2>/dev/null || echo direct)       # "iap" when the network blocks SSH (show.sh finds out)
IAP=(); [ "$MODE" = iap ] && IAP=(--tunnel-through-iap)
gssh() { gcloud compute ssh "$VM" --zone="$ZONE" "${IAP[@]}" --quiet "$@"; }

STATUS=$(gcloud compute instances describe "$VM" --zone="$ZONE" --format="value(status)" 2>/dev/null || true)
if [ "$STATUS" != "RUNNING" ]; then
  echo "The machine is ${STATUS:-not reachable} (not RUNNING). Start it first:  ./show.sh on"
  exit 1
fi

# which Python files changed since the last push? (those need a server restart; web files don't)
SUMS=$(shasum stream_server.py animate.py director.py bookkeeper.py download_models.py bench.py 2>/dev/null)
LAST="$HOME/.stream-proto-last-push"           # kept outside the folder, so replacing the folder doesn't lose it
OLD=$(cat "$LAST" 2>/dev/null || true)

# the version that will run there (shown by ./show.sh status and the run sheet)
VERSION=$(git -C .. describe --always --dirty 2>/dev/null || echo unknown)
echo "$VERSION $(date '+%Y-%m-%d %H:%M')" > .version

# Panel tunings live in tuned.json ON THE MACHINE (never sent from here, never in git). Machines set up before that
# had them inside trajectory.json: keep them once, before this push replaces trajectory.json.
gssh --command 'cd ~/stream-proto 2>/dev/null && [ ! -f tuned.json ] && [ -f trajectory.json ] && python3 -c "
import json; d = json.load(open(\"trajectory.json\"))
json.dump({\"rev\": (d.get(\"world\") or {}).get(\"rev\"), \"pacing\": d.get(\"pacing\", {}), \"world\": {k: v for k, v in (d.get(\"world\") or {}).items() if k != \"rev\"}}, open(\"tuned.json\", \"w\"), indent=2)
print(\"kept the timings tuned on /panel (now in tuned.json on the machine)\")"; true' 2>/dev/null || true

FILES=(web stream_server.py animate.py director.py director.json bookkeeper.py bookkeeper.md bookkeeper.json
       download_models.py bench.py bench_animate.py train_style_lora.py
       setup_sdxl.sh setup_liveportrait.sh setup_cloud.sh install_service.sh
       styles.json trajectory.json CLOUD.md README.md .version)
for k in random_org.key anthropic.key openai.key; do [ -f "$k" ] && FILES+=("$k"); done
[ "${1:-}" = "loras" ] && FILES+=(loras)

echo "sending code to $VM ..."
gcloud compute scp --zone="$ZONE" "${IAP[@]}" --recurse "${FILES[@]}" "$VM":~/stream-proto/ --quiet
echo "$SUMS" > "$LAST"
echo
echo "Sent ($VERSION)."
if [ "$SUMS" != "$OLD" ]; then
  if gssh --command "systemctl is-enabled --quiet chance" 2>/dev/null; then
    gssh --command "sudo systemctl restart chance" && echo "-> the server code changed: restarted the server (ready again in about a minute)"
  else
    echo "-> stream_server.py changed: restart the server on the cloud machine"
    echo "   (in its window: Ctrl + C, then:  PAINTER=sdxl python stream_server.py)   or run ./show.sh setup once"
  fi
else
  echo "-> only page files changed: just reload the page in Chrome."
fi
