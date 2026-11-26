#!/usr/bin/env bash
# show.sh — the whole show from the Mac, in ONE Terminal window. Run it inside the stream-proto folder.
#
#   ./show.sh on          start everything and keep watch. Leave this window open during the show.
#                           keys in this window:  o = open the pages again   d = restart the die reader
#                                                 r = restart the server     q = stop the Mac side (the machine stays on)
#   ./show.sh off         stop everything and switch the machine off (and check it really is off)
#   ./show.sh status      what is on, what is ready
#   ./show.sh log         the server's last 200 lines    ./show.sh log follow    ./show.sh log save  (to the Desktop)
#   ./show.sh restart     restart the server only
#   ./show.sh setup       ONCE: disk to 100 GB, the server as a service, the fallback route for blocked networks
#
# What "on" does: starts the machine (waiting it out if Google has no spot capacity), finds a way in (SSH, or through
# Google on port 443 when the venue's network blocks SSH), keeps the tunnel up (it reconnects by itself), waits until
# the server is really ready, starts the die reader, keeps the Mac awake, opens the panel and the game. Then it keeps
# watch: if Google takes the spot machine back, it starts it again and everything reconnects by itself.
# Settings (optional) in ~/.chance/show.conf:   DICE=1   (the die camera's number; python3 dice_reader.py --list-cameras)
#                                              NO_DICE=1 (don't start the die reader)   NO_OPEN=1 (don't open Chrome)

VM="chance-rtx"
ZONE="asia-south1-c"
PORT=${SHOW_PORT:-8766}                # (tests only: another local port)
DISK_GB=100
RETRY=${RETRY:-30}                    # seconds between tries when Google has no spot capacity
HERE=$(cd "$(dirname "$0")" && pwd)
STATE="$HOME/.chance"
mkdir -p "$STATE/logs"
[ -f "$STATE/show.conf" ] && . "$STATE/show.conf"
DICE=${DICE:-1}

say()  { printf '%s  %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '%s  ! %s\n' "$(date +%H:%M:%S)" "$*"; }
mode() { cat "$STATE/ssh_mode" 2>/dev/null || echo direct; }
iap()  { [ "$(mode)" = iap ] && echo "--tunnel-through-iap"; }
gssh() { gcloud compute ssh "$VM" --zone="$ZONE" $(iap) --quiet "$@"; }
status_of() { gcloud compute instances describe "$VM" --zone="$ZONE" --format="value(status)" 2>/dev/null; }
health() { curl -s -m 3 "http://localhost:$PORT/health" 2>/dev/null; }
field() { python3 -c "import json,sys
try: d = json.loads(sys.argv[1])
except Exception: sys.exit(0)
print(d.get(sys.argv[2], ''))" "$1" "$2"; }
summary() { python3 -c "import json,sys
try: d = json.loads(sys.argv[1])
except Exception: print('not answering'); sys.exit(0)
if not d.get('ready'): print('loading the painter ...'); sys.exit(0)
parts = ['painter ' + d['painter'], 'animator ' + d['animator'], 'director ' + d['director'], 'voice ' + d['voice'],
         'disk %s GB free' % d['disk_free_gb']]
if d.get('version'): parts.append('version ' + d['version'].split()[0])
print(' · '.join(parts))" "$1"; }

need() {
  command -v gcloud >/dev/null || { echo "gcloud isn't installed (see CLOUD.md: brew install --cask google-cloud-sdk)"; exit 1; }
  command -v python3 >/dev/null || { echo "python3 isn't installed"; exit 1; }
}

# ---- the machine ----
start_machine() {
  local s tries=0
  while :; do
    s=$(status_of)
    case "$s" in
      RUNNING) return 0 ;;
      STOPPING|SUSPENDING|PROVISIONING|STAGING|REPAIRING) say "the machine is $s, waiting ..."; sleep 10; continue ;;
      "") warn "can't see the machine (signed in? gcloud auth login)"; return 1 ;;
    esac
    say "starting the machine ..."
    out=$(gcloud compute instances start "$VM" --zone="$ZONE" --quiet 2>&1) && { say "the machine is on"; return 0; }
    if echo "$out" | grep -qiE "resource|capacity|exhausted|unavailable|STOCKOUT"; then
      tries=$((tries + 1))
      warn "Google has no spot GPU free in $ZONE right now (try $tries). Trying again in $RETRY s; Ctrl+C to give up."
      sleep "$RETRY"
    else
      warn "couldn't start it:"; echo "$out" | tail -5; return 1
    fi
  done
}

find_way_in() {                       # SSH straight in, or through Google (port 443) when the network blocks SSH
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if gcloud compute ssh "$VM" --zone="$ZONE" $(iap) --quiet --command true -- -o ConnectTimeout=8 >/dev/null 2>&1; then
      [ "$i" -gt 1 ] && say "in ($(mode))"
      return 0
    fi
    if [ "$i" = 4 ] && [ "$(mode)" = direct ]; then
      warn "SSH isn't getting through (still waking up, or this network blocks it). Trying the route through Google ..."
      echo iap > "$STATE/ssh_mode"
    elif [ "$i" = 8 ] && [ "$(mode)" = iap ]; then
      echo direct > "$STATE/ssh_mode"
    fi
    sleep 10
  done
  warn "can't get into the machine. Is this network online? (./show.sh setup once enables the route through Google)"
  return 1
}

# ---- the tunnel: the machine's server shows up as localhost:8766 on this Mac; it reconnects by itself ----
tunnel_loop() {
  while :; do
    gcloud compute ssh "$VM" --zone="$ZONE" $(iap) --quiet -- -N -L "$PORT:localhost:$PORT" \
      -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -o ConnectTimeout=10 \
      >>"$STATE/logs/tunnel.log" 2>&1
    echo "$(date '+%F %T') tunnel closed, reconnecting" >>"$STATE/logs/tunnel.log"
    sleep 3
  done
}
free_port() {
  pkill -f "$PORT:localhost:$PORT" 2>/dev/null
  sleep 1
  local who
  who=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -Fc 2>/dev/null | sed -n 's/^c//p' | head -1)
  if [ -n "$who" ]; then
    warn "port $PORT on this Mac is taken by '$who' (a server running on the Mac?). Stop it, then run again."
    return 1
  fi
}
start_tunnel() { tunnel_loop & TUNNEL_PID=$!; echo "$TUNNEL_PID" > "$STATE/tunnel.pid"; }
stop_tunnel() {
  [ -f "$STATE/tunnel.pid" ] && kill "$(cat "$STATE/tunnel.pid")" 2>/dev/null
  pkill -f "$PORT:localhost:$PORT" 2>/dev/null
  rm -f "$STATE/tunnel.pid"
}

# ---- the die reader ----
start_dice() {
  [ "${NO_DICE:-0}" = 1 ] && return 0
  pkill -f "dice_reader.py" 2>/dev/null
  if ! python3 -c "import cv2" 2>/dev/null; then
    warn "the die reader needs OpenCV:  python3 -m pip install opencv-python numpy   (the game works with R / the panel meanwhile)"
    return 0
  fi
  (cd "$HERE" && exec python3 dice_reader.py --camera "$DICE") >>"$STATE/logs/dice.log" 2>&1 &
  echo $! > "$STATE/dice.pid"
  say "die reader started (camera $DICE): its window is open. First time or tray moved: c, Enter, l, e"
}
dice_alive() { [ -f "$STATE/dice.pid" ] && kill -0 "$(cat "$STATE/dice.pid")" 2>/dev/null; }
# c in the watching loop: pick another camera for the die, remember it (show.conf), restart the reader on it
change_dice_camera() {
  stop_dice; sleep 1                                     # (the reader lets go of its camera, so every camera can be listed)
  say "cameras on this Mac (the game in Chrome may be holding one: it then shows no picture):"
  (cd "$HERE" && python3 dice_reader.py --list-cameras 2>/dev/null) | sed 's/^/           /'
  printf '           die camera number [now %s, Enter keeps it]: ' "$DICE"; read -r n
  case "$n" in
    "") ;;
    *[!0-9]*) warn "not a number: keeping camera $DICE" ;;
    *) DICE=$n
       mkdir -p "$STATE"; touch "$STATE/show.conf"
       grep -v '^DICE=' "$STATE/show.conf" > "$STATE/show.conf.new" 2>/dev/null; echo "DICE=$DICE" >> "$STATE/show.conf.new"
       mv "$STATE/show.conf.new" "$STATE/show.conf"
       say "the die camera is now $DICE (saved for next time)" ;;
  esac
  start_dice
}
stop_dice() { pkill -f "dice_reader.py" 2>/dev/null; rm -f "$STATE/dice.pid"; }

open_pages() {
  [ "${NO_OPEN:-0}" = 1 ] && return 0
  open -a "Google Chrome" "http://localhost:$PORT/panel" "http://localhost:$PORT/game" 2>/dev/null \
    || open "http://localhost:$PORT/panel" "http://localhost:$PORT/game"
  say "opened the panel and the game. On the game: F (fullscreen), click once (sound), throw."
}

was_taken_back() {                    # did Google preempt the spot machine since $1 (UTC, ISO)? (times compared as times)
  local t
  t=$(gcloud compute operations list --zones="$ZONE" --filter="operationType=compute.instances.preempted AND targetLink~/$VM\$" \
      --sort-by=~insertTime --format="value(insertTime)" --limit=1 2>/dev/null)
  [ -n "$t" ] && python3 -c "import sys, datetime as D
f = lambda x: D.datetime.fromisoformat(x.strip().replace('Z', '+00:00'))
sys.exit(0 if f(sys.argv[1]) >= f(sys.argv[2]) else 1)" "$t" "$1" 2>/dev/null
}

wait_ready() {                        # until /health says ready (or give up after ~6 min)
  local i h
  for i in $(seq 1 72); do
    h=$(health)
    if [ "$(field "$h" ready)" = "True" ]; then return 0; fi
    if [ "$i" = 1 ] || [ $((i % 6)) = 0 ]; then
      if [ -n "$h" ]; then say "waiting for the server: $(summary "$h")"
      else                              # it doesn't answer at all while loading its models: ask the machine instead
        case "$(gssh --command 'systemctl is-active chance 2>/dev/null; systemctl is-enabled chance 2>/dev/null' 2>/dev/null | tr '\n' ' ')" in
          active*) say "waiting for the server: loading its models (1-3 min after the machine starts)" ;;
          activating*|*enabled*) say "waiting for the server: (re)starting" ;;
          *) say "waiting for the server: it isn't running as a service yet. Run ./show.sh setup once (or ./show.sh log for why)" ;;
        esac
      fi
    fi
    sleep 5
  done
  warn "the server isn't answering. ./show.sh log shows why. (Never ran ./show.sh setup? Then it isn't a service yet.)"
  return 1
}

cleanup_mac() {
  stop_tunnel; stop_dice
  [ -n "${CAFF_PID:-}" ] && kill "$CAFF_PID" 2>/dev/null
}

# ======================================================================================
cmd_on() {
  need
  local START_ISO; START_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  caffeinate -dimsu -w $$ & CAFF_PID=$!                       # the Mac stays awake while this runs (keep it plugged in)
  trap 'echo; cleanup_mac; say "Mac side stopped. The machine is still ON and spending credit:  ./show.sh off"; exit 0' INT TERM
  start_machine || exit 1
  echo direct > "$STATE/ssh_mode"                             # each show: straight SSH first (the fallback is slower)
  find_way_in || exit 1
  # newer code on this Mac than on the machine? send it (and the keys)
  local here there
  here="$(git -C "$HERE/.." describe --always --dirty 2>/dev/null)"
  there="$(gssh --command 'cat ~/stream-proto/.version 2>/dev/null' 2>/dev/null | awk '{print $1}')"
  if [ -n "$here" ] && [ "$here" != "$there" ]; then say "the machine has ${there:-an older version}, this Mac $here: sending it ..."; "$HERE/push.sh" | sed 's/^/           /'; fi
  free_port || exit 1
  start_tunnel
  wait_ready || { say "watching anyway; press q to stop"; }
  say "ready: $(summary "$(health)")"
  start_dice
  sleep 2
  open_pages
  echo
  say "watching. Keys: o open pages · d die reader · c die camera · r restart server · q stop (Mac side)"

  local last="" h line s miss=0 lastvm=0 vm="RUNNING" idle_warned=0
  while :; do
    key=""
    if [ -t 0 ]; then read -r -s -n 1 -t 5 key; else sleep 5; fi
    case "$key" in
      o) open_pages ;;
      d) start_dice ;;
      c) change_dice_camera ;;
      r) say "restarting the server ..."; gssh --command "sudo systemctl restart chance" >/dev/null 2>&1; sleep 5 ;;
      q) cleanup_mac; say "Mac side stopped. The machine is still ON and spending credit:  ./show.sh off"; exit 0 ;;
    esac
    h=$(health)
    if [ "$(field "$h" ready)" = "True" ]; then
      miss=0; line="ok · $(summary "$h")"
      left=$(field "$h" idle_off_in_min)
      if [ -n "$left" ] && python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) <= 5 else 1)" "$left" 2>/dev/null; then
        [ "$idle_warned" = 0 ] && warn "no page open: the machine switches itself off in about ${left%.*} min (open the game to keep it on)"
        idle_warned=1
      else idle_warned=0; fi
    else
      miss=$((miss + 1)); line="server not answering"
    fi
    [ "$line" != "$last" ] && { say "$line"; last="$line"; }
    dice_alive || { [ "${NO_DICE:-0}" = 1 ] || [ ! -f "$STATE/dice.pid" ] || { warn "the die reader stopped (press d to start it again; R or the panel's ROLL work meanwhile)"; rm -f "$STATE/dice.pid"; }; }

    # not answering for ~30 s: what's wrong with the machine?
    if [ "$miss" -ge 6 ] && [ $((SECONDS - lastvm)) -ge 30 ]; then
      lastvm=$SECONDS; vm=$(status_of)
      if [ "$vm" = RUNNING ]; then
        if [ "$(mode)" = direct ] && tail -5 "$STATE/logs/tunnel.log" 2>/dev/null | grep -qiE "timed out|refused|unreachable|Connection closed"; then
          warn "the tunnel can't get through on SSH: switching to the route through Google"
          echo iap > "$STATE/ssh_mode"; pkill -f "$PORT:localhost:$PORT" 2>/dev/null
        else
          say "the machine is on; the server is (re)starting or the tunnel is reconnecting, both happen by themselves"
        fi
      elif was_taken_back "$START_ISO"; then
        warn "Google took the spot machine back. Starting it again (about 3 min; the game carries on by itself after)"
        START_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
        start_machine && find_way_in && pkill -f "$PORT:localhost:$PORT" 2>/dev/null
      else
        warn "the machine is $vm: it switched itself off (no page open for a while) or was stopped. Start it again:  ./show.sh on"
        cleanup_mac; exit 1
      fi
    fi
  done
}

cmd_off() {
  need
  stop_tunnel; stop_dice; pkill -f "caffeinate -dimsu" 2>/dev/null
  local s; s=$(status_of)
  if [ "$s" = RUNNING ]; then
    local f; f="$STATE/logs/server-$(date +%Y%m%d-%H%M).log"
    gssh --command "journalctl -u chance -n 3000 --no-pager -o short-iso" >"$f" 2>/dev/null && say "saved the server's log: $f"
    say "switching the machine off ..."
    gcloud compute instances stop "$VM" --zone="$ZONE" --quiet >/dev/null 2>&1
  fi
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    s=$(status_of)
    if [ "$s" = TERMINATED ] || [ "$s" = STOPPED ]; then say "the machine is OFF ($s). No more credit is being spent on it."; return 0; fi
    sleep 5
  done
  warn "the machine still says $s. Check:  gcloud compute instances list   (or the Cloud console, Compute Engine → VM instances)"
}

cmd_status() {
  need
  local s h; s=$(status_of)
  say "machine: ${s:-unknown} ($(gcloud compute instances describe "$VM" --zone="$ZONE" --format='value(scheduling.provisioningModel)' 2>/dev/null) · way in: $(mode))"
  h=$(health)
  if [ -n "$h" ]; then say "server (through the tunnel): $(summary "$h")"
  elif [ "$s" = RUNNING ]; then
    h=$(gssh --command "curl -s -m 3 localhost:$PORT/health" 2>/dev/null)
    say "tunnel: not open on this Mac · server (on the machine): $(summary "$h")"
  fi
  [ -n "$h" ] && [ -n "$(field "$h" idle_off_in_min)" ] && say "switches itself off after $(field "$h" idle_off_in_min) more min with no page open"
  if dice_alive; then say "die reader: running"; else say "die reader: not running"; fi
}

cmd_log() {
  need
  case "${1:-}" in
    follow) gssh --command "journalctl -u chance -f -n 50 --no-pager -o cat" ;;
    save) f="$HOME/Desktop/chance-server-log-$(date +%Y%m%d-%H%M).txt"
          gssh --command "journalctl -u chance -n 5000 --no-pager -o short-iso" >"$f" && say "saved to the Desktop: $(basename "$f")" ;;
    *) gssh --command "journalctl -u chance -n ${1:-200} --no-pager -o cat" ;;
  esac
}

cmd_setup() {
  need
  say "one-time setup for $VM"
  start_machine || exit 1
  # 1. the disk
  local disk size
  disk=$(gcloud compute instances describe "$VM" --zone="$ZONE" --format="value(disks[0].source.basename())")
  size=$(gcloud compute disks describe "$disk" --zone="$ZONE" --format="value(sizeGb)")
  if [ "${size:-0}" -lt "$DISK_GB" ]; then
    say "disk: $size GB -> $DISK_GB GB"
    gcloud compute disks resize "$disk" --zone="$ZONE" --size="${DISK_GB}GB" --quiet || warn "couldn't resize the disk"
  else say "disk: already $size GB"; fi
  # 2. the route through Google, for networks that block SSH
  local net; net=$(gcloud compute instances describe "$VM" --zone="$ZONE" --format="value(networkInterfaces[0].network.basename())")
  gcloud services enable iap.googleapis.com --quiet >/dev/null 2>&1 || warn "couldn't enable IAP (the fallback route); fine on networks that allow SSH"
  if ! gcloud compute firewall-rules describe allow-ssh-through-google >/dev/null 2>&1; then
    gcloud compute firewall-rules create allow-ssh-through-google --network="$net" --direction=INGRESS \
      --allow=tcp:22 --source-ranges=35.235.240.0/20 --quiet >/dev/null && say "fallback route: ready" || warn "couldn't add the fallback route"
  else say "fallback route: already there"; fi
  find_way_in || exit 1
  # 3. the filesystem grows into the bigger disk
  gssh --command 'R=$(findmnt -n -o SOURCE /); P=$(lsblk -no pkname "$R"); N=$(cat /sys/class/block/$(basename "$R")/partition 2>/dev/null); [ -n "$N" ] && sudo growpart /dev/$P $N >/dev/null 2>&1; sudo resize2fs "$R" >/dev/null 2>&1; df -h / | tail -1' \
    | awk '{print "         disk now: " $2 " (" $4 " free)"}'
  # 4. the latest code, then the server as a service
  "$HERE/push.sh" | sed 's/^/           /'
  gssh --command "cd ~/stream-proto && bash install_service.sh" | sed 's/^/           /'
  # 5. this Mac
  python3 -c "import cv2" 2>/dev/null && say "die reader: OpenCV is here" || say "die reader: run  python3 -m pip install opencv-python numpy"
  if [ ! -f "$STATE/show.conf" ]; then
    printf 'Which camera number is the die camera? (python3 dice_reader.py --list-cameras) [1]: '; read -r n
    echo "DICE=${n:-1}" > "$STATE/show.conf"
  fi
  say "done. From now on:  ./show.sh on   and   ./show.sh off"
}

case "${1:-}" in
  on) cmd_on ;;
  off) cmd_off ;;
  status) cmd_status ;;
  log) cmd_log "${2:-}" ;;
  restart) need; gssh --command "sudo systemctl restart chance" && say "restarted; ready again in about a minute" ;;
  setup) cmd_setup ;;
  *) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
