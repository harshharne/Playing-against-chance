# Live generation — webcam → fast diffusion, you and the background separately

## First time only: download the models (~5 GB, saved in ~/.cache/huggingface)
```
cd ~/Downloads/stream-proto
source ~/Downloads/chance-proto/.venv/bin/activate
python -m pip install -U diffusers transformers peft accelerate
python download_models.py
```
If the download stops halfway, run `python download_models.py` again: it carries on.

## Two pages
- http://localhost:8766/game — the game: BIRTH → BODY → HOME → WORLD → the baseline. Space / Enter = the big button, keys 1–6 pick a sperm.
- http://localhost:8766/dice.html — set up the physical die (see below).
- http://localhost:8766 — the lab: type prompts and add references by hand to tune the look. References set here carry over into the game.

## The die (optional)
Your throw is your wish, random.org rolls chance's answer. The die is read with plain image processing in the browser (no AI, no GPU).
How: a picture of the EMPTY throwing area is remembered; after a throw, whatever differs from it is the die (table, tape, stains and glare cancel out). The top face is the die's brightest part, the dots are the holes in it.
- A webcam pointing straight down at the throwing square. Even light. A die with dark dots.
- Open http://localhost:8766/dice.html → pick the DICE CAMERA and the AVATAR CAMERA → drag a box just inside the square → take the die out and press EMPTY TRAY → throw a few times (green = what changed, box = top face, red = dots) → SAVE FOR THE GAME.
- Press EMPTY TRAY again whenever the camera moves or the light changes a lot.
- Tuning: SENSITIVITY lower if parts of the die aren't green, higher if the table turns green. TOP FACE higher if side dots get counted, lower if dots are missed.
- In the game, the chip under PIXEL / LINE / PAINT shows the die. Every button shows the faces that pick it (fewer than six choices share the faces; set your own with `faces` in stages.js). Between stages, a throw = the big button. Clicking, and keys 1–6 as faces, still work.
- With no dice camera saved the game works as before.

## The look
In the game, the PIXEL / LINE / PAINT switch under the stage names changes the look at any moment (it redraws what's on screen and is remembered). `LOOK` at the top of `web/stages.js` is the one it starts with. In the lab, the LOOK menu does the same.
Filter details (block size, colour levels, dither) are at the top of the look section in `web/live.js`.

## Changing the trajectories
Everything chance can hand out (options, odds, prompt fragments, wording) is in `web/stages.js`. Edit it and reload the page; no restart needed.

## Run
```
cd ~/Downloads/stream-proto
source ~/Downloads/chance-proto/.venv/bin/activate
python stream_server.py
```
Open http://localhost:8766 in Chrome and allow the camera. The Mac needs to be online (the person cut-out loads from the internet).

- YOU / BACKGROUND: a prompt for each, press Enter. Either can be left empty.
- STYLE / IMAGE slots next to each prompt: click or drag an image in; × removes it.
  - STYLE steers the look.
  - IMAGE for you: what you should resemble (mixed with the style).
  - IMAGE for the background: becomes the starting picture, re-imagined by the prompt.
- CHANGE: how much you get re-imagined (0.3 = still you, 0.9 = mostly invented).
- STYLE: how strongly the STYLE / IMAGE references steer the look (0 = ignore them, 1+ = push hard).
- STEADY: how much each frame leans on the last one. Higher = less flicker, but slower to follow you (ghosting). Lower = quicker, more flicker.
- When you stand still, no new frames are made, so a still you stays perfectly still.
- Every Enter makes a new background, even with the same prompt.
- The small window in the corner is the plain camera.

## Models
- A different SD 1.5 base model: `MODEL=stablediffusionapi/anything-v5 python stream_server.py` (anime). Any SD 1.5 model in diffusers format works; it downloads on first start.

## Engines
- default `sd15`: DreamShaper 8 + LCM-LoRA + IP-Adapter. All reference slots work.
- `ENGINE=turbo python stream_server.py`: the earlier SD-Turbo version. Faster, but only the background IMAGE slot works.
- `MOCK=1 python stream_server.py`: no model, fake effect, to test the page.

## Knobs (top of stream_server.py)
- PERSON_STEPS 1 — set to 2 for a cleaner image at about half the fps
- BG_IMAGE_KEEP 0.35 — how much of the background IMAGE reference survives
- WIDTH × HEIGHT 640×384 — smaller (e.g. 512×320) = faster
