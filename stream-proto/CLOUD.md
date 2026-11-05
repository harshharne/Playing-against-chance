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

## Every session
1. Start the machine:      gcloud compute instances start chance-rtx --zone=asia-south1-c
2. Start the server:       gcloud compute ssh chance-rtx --zone=asia-south1-c
                           cd ~/stream-proto && source .venv/bin/activate && PAINTER=sdxl python stream_server.py
                           (first time with SDXL: run  bash setup_sdxl.sh  once before this; see README)
3. Open the tunnel (a NEW Mac Terminal window, leave it open):
                           gcloud compute ssh chance-rtx --zone=asia-south1-c -- -N -L 8766:localhost:8766
4. On your Mac, open:      http://localhost:8766/game     (make sure the Mac server is NOT running)
5. When done, STOP it:     gcloud compute instances stop chance-rtx --zone=asia-south1-c
   A stopped machine costs only its disk (cents a month). A running one ~US$0.74 an hour from your credit.

## Updating the code later
Edit on the Mac as usual, then from the stream-proto folder on the Mac:
    ./push.sh
It sends everything up and says whether the server needs a restart (Python changed) or just a page reload (web files changed).
The first time, macOS may need:  chmod +x push.sh
