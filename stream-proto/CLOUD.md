# Running the generation on Google Cloud (now: chance-rtx, RTX PRO 6000 spot, asia-south1-c; first set up on an L4)

The game page, camera and filters stay on your Mac. Only stream_server.py runs on the cloud machine.
A tunnel makes the cloud server show up as http://localhost:8766 on your Mac, so nothing in the code changes.

## Once: on your Mac, install the Google Cloud command line
    brew install --cask google-cloud-sdk        (or the installer from cloud.google.com/sdk)
    gcloud auth login
    gcloud config set project project-d93a8bb5-9b08-4526-b4c

## Once: create the machine (Cloud Shell or Mac), after the GPU quota is approved
    gcloud compute instances create chance-gpu \
      --zone=asia-south1-b --machine-type=g2-standard-4 \
      --network-interface=nic-type=GVNIC --maintenance-policy=TERMINATE \
      --create-disk=auto-delete=yes,boot=yes,image-family=ubuntu-2204-lts,image-project=ubuntu-os-cloud,size=60GB,type=pd-balanced \
      --metadata=startup-script='#!/bin/bash
    # runs on every boot until the driver works (the installer restarts the machine between its rounds)
    if ! nvidia-smi >/dev/null 2>&1; then
      mkdir -p /opt/google && cd /opt/google
      [ -f cuda_installer.pyz ] || curl -fsSL -O https://storage.googleapis.com/compute-gpu-installation-us/installer/latest/cuda_installer.pyz
      python3 cuda_installer.pyz install_driver --installation-mode=repo --installation-branch=prod
    fi'
Wait ~10 minutes (the machine restarts itself once or twice), then `nvidia-smi` on the machine should show an NVIDIA L4.
If it still doesn't after 15 minutes, run the installer line by hand with sudo, and `sudo reboot` once it finishes.
(if asia-south1-b has no capacity, try asia-south1-a or asia-south1-c, and use that zone everywhere below)

## Once: copy the project up and set it up (from your Mac, in ~/Downloads)
    gcloud compute scp stream-proto.zip chance-rtx:~ --zone=asia-south1-c
    gcloud compute ssh chance-rtx --zone=asia-south1-c
        (now you're on the cloud machine)
        sudo apt-get install -y unzip && unzip -o stream-proto.zip && cd stream-proto
        bash setup_cloud.sh

## Once: ./show.sh setup (on the Mac, in stream-proto)
    chmod +x show.sh push.sh && ./show.sh setup
Grows the disk to 100 GB, makes the server a service (it starts with the machine, restarts itself after a crash,
keeps its log: journalctl -u chance), adds the route through Google for networks that block SSH (IAP, port 443),
and asks for the die camera's number (kept in ~/.chance/show.conf).

## Every session
    ./show.sh on          one window, leave it open: starts the machine, sends newer code, keeps the tunnel up
                          (reconnects by itself), waits for the server, starts the die reader, keeps the Mac awake,
                          opens /panel and /game. If Google takes the spot machine back, it starts it again.
                          Keys there: o pages again · d die reader · r restart the server · q stop the Mac side
    ./show.sh off         saves the log to ~/.chance/logs, stops everything, switches the machine off and checks it
    ./show.sh status      what's on and ready         ./show.sh log save   the server's log onto the Desktop
    ./show.sh restart     restart the server only
The machine also switches itself off after 30 minutes with no page open (IDLE_OFF_MIN in server.env; 0 = never).
It's a SPOT machine (g4-standard-48, RTX PRO 6000): much cheaper than standard, but Google can take it back at any time
(it is then stopped, not deleted: ./show.sh on starts it again) and on busy days may have no capacity (show.sh keeps
trying). The price moves: see Billing -> Reports in the Cloud console. A stopped machine costs only its disk.

By hand, if show.sh can't run (four windows):
1. Start the machine:      gcloud compute instances start chance-rtx --zone=asia-south1-c
2. The server is a service after setup: it starts by itself. (Before setup: gcloud compute ssh chance-rtx
                           --zone=asia-south1-c, then  cd ~/stream-proto && source .venv/bin/activate && PAINTER=sdxl python stream_server.py)
3. Open the tunnel (a NEW Mac Terminal window, leave it open):
                           gcloud compute ssh chance-rtx --zone=asia-south1-c -- -N -L 8766:localhost:8766
                           (network blocks SSH? add --tunnel-through-iap after the zone)
4. On your Mac, open:      http://localhost:8766/game     (make sure the Mac server is NOT running)
5. When done, STOP it:     gcloud compute instances stop chance-rtx --zone=asia-south1-c

## Settings tuned on /panel
The timings and world settings tuned on /panel are kept in tuned.json ON THE MACHINE, over trajectory.json (which comes
from git). push.sh never overwrites them, and trajectory.json on the Mac never changes, so pulls don't conflict.
When the code re-bases the settings (world.rev in trajectory.json changes), the old tunings are left behind once.

## Health
http://localhost:8766/health (and ./show.sh status): painter, animator, director and voice keys, free disk, GPU memory,
how long until it switches itself off, and the version running (from push.sh).

## The animation layer (LivePortrait): once
On the cloud machine, after setup_sdxl.sh:
    cd ~/stream-proto && source .venv/bin/activate && bash setup_liveportrait.sh
It clones LivePortrait to ~/LivePortrait, downloads its weights (~0.6 GB) and runs the speed check (bench_animate.py).
The server then loads the animator by itself after the painter (ANIMATE=0 turns it off).
Test page, through the tunnel: http://localhost:8766/animate.html

## Training the style LoRA
1. On the Mac, put 20-40 images in ONE look in a folder (e.g. ~/style). Only images you have the right to use.
   Optional: a .txt beside an image saying what's in it; otherwise BLIP describes each one.
2. Send the folder up (Mac):   gcloud compute scp --recurse ~/style chance-rtx:~/style --zone=asia-south1-c
3. Train (cloud, in ~/stream-proto with the venv on):
       pip install -q peft && python train_style_lora.py ~/style --name mylook
   About 20-30 min (+ a ~7 GB download the first time). It prints the loss and the minutes left.
   It can run while the server runs (both fit on the GPU), in its own ssh window.
4. On /panel: LORA A = mylook (or mylook-early), weight about 0.8. It works on worlds, portraits and the live avatar.

## Updating the code later
Edit on the Mac as usual, then from the stream-proto folder on the Mac:
    ./push.sh
It checks the machine is on, sends everything in one go (with the keys), and restarts the server by itself when Python changed
(once it's a service); for page files, just reload. ./show.sh on runs it for you when the Mac has newer code.
The first time, macOS may need:  chmod +x push.sh
