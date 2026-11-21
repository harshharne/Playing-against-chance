#!/usr/bin/env bash
# Run ONCE on the cloud machine, inside ~/stream-proto (./show.sh setup on the Mac does it for you):
#     bash install_service.sh
# The server becomes a service: it starts by itself every time the machine starts, restarts itself if it ever
# crashes, and keeps its log even when no window is open (./show.sh log on the Mac shows it).
# Settings for the service (optional): a file server.env next to this one, e.g.
#     PAINTER=sdxl
#     IDLE_OFF_MIN=30        (0 = never switch the machine off by itself)
#     ANIMATE=0              (no animator)
set -e
cd "$(dirname "$0")"
DIR=$(pwd)
ME=$(whoami)
[ -x "$DIR/.venv/bin/python" ] || { echo "No .venv here: run setup_cloud.sh first."; exit 1; }

sudo tee /etc/systemd/system/chance.service >/dev/null <<EOF
[Unit]
Description=Playing Against Chance (the game's server)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
User=$ME
WorkingDirectory=$DIR
Environment=PAINTER=sdxl
Environment=IDLE_OFF_MIN=30
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=-$DIR/server.env
ExecStart=$DIR/.venv/bin/python stream_server.py
Restart=always
RestartSec=5
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
EOF

# keep the log across restarts of the machine (small: at most 500 MB)
sudo mkdir -p /var/log/journal
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=persistent\nSystemMaxUse=500M\n' | sudo tee /etc/systemd/journald.conf.d/chance.conf >/dev/null
sudo systemctl restart systemd-journald

# a server started by hand in a window would hold the port: stop it, the service takes over
if ! systemctl is-active --quiet chance; then
  pkill -f "python stream_server.py" 2>/dev/null && echo "stopped the server that was running in a window" || true
  sleep 2
fi
sudo systemctl daemon-reload
sudo systemctl enable chance >/dev/null
sudo systemctl restart chance
echo "The server is now a service: it starts with the machine and restarts itself."
echo "Its log:  journalctl -u chance -f      (or ./show.sh log on the Mac)"
