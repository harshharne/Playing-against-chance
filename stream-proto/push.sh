#!/usr/bin/env bash
# Run on your MAC, inside the stream-proto folder, after editing:
#     ./push.sh          sends the code (pages + server) and tells you whether the server needs a restart
#     ./push.sh loras    also sends the LoRA files in loras/ (only needed when you add your own)
set -e
VM="chance-gpu"
ZONE="asia-south1-b"
cd "$(dirname "$0")"

# which Python files changed since the last push? (those need a server restart; web files don't)
SUMS=$(shasum stream_server.py download_models.py 2>/dev/null)
LAST="$HOME/.stream-proto-last-push"           # kept outside the folder, so replacing the folder doesn't lose it
OLD=$(cat "$LAST" 2>/dev/null || true)

echo "sending code to $VM ..."
gcloud compute scp --zone="$ZONE" --recurse \
  web stream_server.py download_models.py styles.json setup_cloud.sh CLOUD.md README.md \
  "$VM":~/stream-proto/ --quiet

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
