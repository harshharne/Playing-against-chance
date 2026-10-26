# Live generation — webcam → fast diffusion, you and the background separately

## First time only: download the models (on chance-gpu, ~6 GB, saved in ~/.cache/huggingface)
```
cd ~/stream-proto && source .venv/bin/activate && python download_models.py
```
If the download stops halfway, run it again: it carries on.

## Pages
- http://localhost:8766/panel — the tuning panel (see below).
- http://localhost:8766/game — the game: BIRTH → BODY → HOME → WORLD → the baseline. Space / Enter = the big button, keys 1–6 pick a sperm.
- http://localhost:8766/dice.html — set up the physical die (see below).
- http://localhost:8766 — the lab: type prompts and add references by hand to tune the look. References set here carry over into the game.

## The die (optional)
**Two ways to read it.** The game uses whichever is there when the page opens:
1. `dice_reader.py`: OpenCV on the Mac, round tray, angled camera, its own window. It runs on the Mac, never on the cloud machine:
   `pip install opencv-python numpy`, then `python dice_reader.py --list-cameras`, then `python dice_reader.py --camera N`.
   Set it up in its window (c = mark the tray, l = lock, e = empty tray), THEN open the game. It tells the game on http://localhost:8767/events (`web/dice-remote.js`). Hover the DIE chip in the game to see which reader it's using.
2. The browser reader below, if dice_reader.py isn't running.

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
On the cloud machine (chance-gpu), see CLOUD.md for the full routine:
```
cd ~/stream-proto && source .venv/bin/activate && python stream_server.py
```
Then on the Mac, through the tunnel: http://localhost:8766/game (the game), http://localhost:8766 (the lab), http://localhost:8766/panel (tuning).

## The lab (http://localhost:8766)
- YOU / BACKGROUND: a prompt for each, press Enter. Either can be left empty.
- STYLE / IMAGE slots next to each prompt: click or drag an image in; × removes it. They feed IP-Adapter (strength on the panel).
  The background IMAGE becomes the starting picture, re-imagined by the prompt.
- LOOK: a browser filter over everything (8-bit, line drawing, or as generated).
- When you stand still, no new frames are made, so a still you stays perfectly still. Every Enter makes a new background.

## The tuning panel (http://localhost:8766/panel)
All painting settings live on the server, so the panel tunes the game and the lab live, while they run. Nothing needs a restart.
- STRUCTURE: ControlNet (depth / pose) arrives in stage 2.
- STYLE: two LoRA slots with weights, reference style strength (IP-Adapter), style prompt (added to every prompt), negative prompt, prompt guidance.
  Guidance 1.0 = off (fastest). The negative prompt only does something above 1.0, and then each frame costs about twice as long.
- CHANGE: how much of you is repainted; world steps (1–4).
- STABILITY: STEADY, how much each frame leans on the last one.
- READOUT: painter, avatar frames per second, ms per frame, world time, GPU memory.
- PRESETS: save / load all of the above by name (files in presets/ on the server).
Note: the game's per-stage CHANGE values in stages.js aren't used any more; CHANGE comes from the panel.

## The painter
- default `dmd`: DreamShaper 8, distilled to ONE step with DMD (`aaronb/dreamshaper-8-dmd-1kstep`, from the OpenDMD project).
  It is at its best painting from pure noise (CHANGE 1.0), with ControlNet holding the body (stage 2).
- `PAINTER=lcm python stream_server.py`: the previous painter (DreamShaper 8 + LCM-LoRA), to compare.
- `MOCK=1 python stream_server.py`: no model, fake effect, to test the pages.
No anime models are used anywhere.

## Style LoRAs (loras/ folder, on the machine that runs the server)
Any SD 1.5 LoRA (.safetensors) in loras/ shows up on the panel within a few seconds. A .txt with the same name holds trigger words.
Downloaded on first start:
- pixel-art.safetensors: PixelArtRedmond 1.5 (artificialguybr), trigger "Pixel Art, PixArFK"
- sketch.safetensors: a small sketch LoRA trained on scene sketches (jordanhilado/sd-1-5-sketch-lora). The weakest of the three; a placeholder.
- watercolor.safetensors: fladdict/watercolor, trigger "watercolor painting"
Your own LoRAs: put them in loras/ on the Mac, then `./push.sh loras` sends them.

## Knobs (top of stream_server.py)
- TUNE_DEFAULTS: the panel's starting values
- BG_IMAGE_KEEP 0.35: how much of the background IMAGE reference survives
- WIDTH × HEIGHT 640×384: smaller (e.g. 512×320) = faster
