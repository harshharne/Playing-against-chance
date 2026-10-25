#!/usr/bin/env bash
# Run on your MAC, inside the stream-proto folder, after editing:
#     ./push.sh
# Sends the code to the cloud machine and tells you whether the server needs a restart.
set -e
VM="chance-gpu"
ZONE="asia-south1-b"
cd "$(dirname "$0")"

# which Python files changed since the last push? (those need a server restart; web files don't)
SUMS=$(shasum stream_server.py download_models.py 2>/dev/null)
OLD=$(cat .last_push 2>/dev/null || true)

echo "sending code to $VM ..."
gcloud compute scp --zone="$ZONE" --recurse \
  web stream_server.py download_models.py setup_cloud.sh CLOUD.md README.md \
  "$VM":~/stream-proto/ --quiet

echo "$SUMS" > .last_push
echo
echo "Sent."
if [ "$SUMS" != "$OLD" ]; then
  echo "-> stream_server.py changed: restart the server on the cloud machine"
  echo "   (in its window: Ctrl + C, then:  python stream_server.py)"
else
  echo "-> only page files changed: just reload the page in Chrome."
fi
