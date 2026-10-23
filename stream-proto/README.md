# Live generation — webcam → SD-Turbo, one step per frame

## Run on the Mac
```
cd ~/Downloads/stream-proto
source ~/Downloads/chance-proto/.venv/bin/activate   # the venv that already runs SD-Turbo
python stream_server.py
```
Open http://localhost:8766 in Chrome, allow the camera.
Type a prompt for YOU and/or for the BACKGROUND, press Enter. Either can be left empty.
CHANGE slider: how much you get re-imagined (0.3 = still you, 0.9 = mostly invented).
Every Enter makes a new background, even with the same prompt.
The person cut-out (MediaPipe) loads from the internet, so the Mac needs to be online.
The first start downloads the tiny VAE (madebyollin/taesd, ~10 MB) and warms up.

Test the page without the model: `MOCK=1 python stream_server.py`

## Knobs (top of stream_server.py)
- SMOOTH 0.25 — blends with the previous frame; higher = calmer but ghostier
- WIDTH × HEIGHT 640×384 — smaller (e.g. 512×320) = faster
- SEED — a different "look" for the same prompt
