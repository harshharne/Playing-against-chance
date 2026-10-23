# Live generation — webcam → SD-Turbo, one step per frame

## Run on the Mac
```
cd ~/Downloads/stream-proto
source ~/Downloads/chance-proto/.venv/bin/activate   # the venv that already runs SD-Turbo
python stream_server.py
```
Open http://localhost:8766 in Chrome, allow the camera, type a prompt, press Enter.
The first start downloads the tiny VAE (madebyollin/taesd, ~10 MB) and warms up.

Test the page without the model: `MOCK=1 python stream_server.py`

## Knobs (top of stream_server.py)
- STRENGTH 0.5 — lower keeps more of you and the room, higher invents more (try 0.25 / 0.75)
- SMOOTH 0.25 — blends with the previous frame; higher = calmer but ghostier
- WIDTH × HEIGHT 640×384 — smaller (e.g. 512×320) = faster
- SEED — a different "look" for the same prompt
