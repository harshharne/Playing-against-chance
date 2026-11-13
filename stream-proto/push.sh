#!/usr/bin/env bash
# Run on your MAC, inside the stream-proto folder, after editing:
#     ./push.sh          sends the code (pages + server) and tells you whether the server needs a restart
#     ./push.sh loras    also sends the LoRA files in loras/ (only needed when you add your own)
set -e
VM="chance-rtx"
ZONE="asia-south1-c"
cd "$(dirname "$0")"

# which Python files changed since the last push? (those need a server restart; web files don't)
SUMS=$(shasum stream_server.py animate.py download_models.py bench.py 2>/dev/null)
LAST="$HOME/.stream-proto-last-push"           # kept outside the folder, so replacing the folder doesn't lose it
OLD=$(cat "$LAST" 2>/dev/null || true)

# trajectory.json: the WORDS come from this Mac (edit them here); the TIMINGS come from the cloud machine
# (that's where /panel -> PACING saves them). So first fetch the cloud copy and keep its "pacing" and "world".
if gcloud compute scp --zone="$ZONE" "$VM":~/stream-proto/trajectory.json /tmp/stream-proto-cloud-trajectory.json --quiet 2>/dev/null; then
  python3 - <<'PY'
import json
mine, cloud = json.load(open("trajectory.json")), json.load(open("/tmp/stream-proto-cloud-trajectory.json"))
changed = [k for k in ("pacing", "world") if cloud.get(k) and cloud.get(k) != mine.get(k)]
for k in changed:
    mine[k] = cloud[k]
if changed:
    json.dump(mine, open("trajectory.json", "w"), indent=2, ensure_ascii=False)
    print("kept the timings tuned on /panel (" + ", ".join(changed) + ") in your trajectory.json")
PY
fi

echo "sending code to $VM ..."
gcloud compute scp --zone="$ZONE" --recurse \
  web stream_server.py animate.py download_models.py bench.py bench_animate.py train_style_lora.py setup_sdxl.sh setup_liveportrait.sh \
  styles.json trajectory.json setup_cloud.sh CLOUD.md README.md \
  "$VM":~/stream-proto/ --quiet

if [ -f random_org.key ]; then
  gcloud compute scp --zone="$ZONE" random_org.key "$VM":~/stream-proto/ --quiet
fi

if [ "$1" = "loras" ]; then
  echo "sending LoRAs ..."
  gcloud compute scp --zone="$ZONE" --recurse loras "$VM":~/stream-proto/ --quiet
fi

echo "$SUMS" > "$LAST"
echo
echo "Sent."
if [ "$SUMS" != "$OLD" ]; then
  echo "-> stream_server.py changed: restart the server on the cloud machine"
  echo "   (in its window: Ctrl + C, then:  python stream_server.py)"
else
  echo "-> only page files changed: just reload the page in Chrome."
  echo "   (new LoRAs show up on /panel by themselves)"
fi
