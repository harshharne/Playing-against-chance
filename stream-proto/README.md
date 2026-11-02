# Live generation — webcam → fast diffusion, you and the background separately

## First time only: download the models (on chance-gpu, ~6 GB, saved in ~/.cache/huggingface)
```
cd ~/stream-proto && source .venv/bin/activate && python download_models.py
```
If the download stops halfway, run it again: it carries on.

## Pages
- http://localhost:8766/panel — the tuning panel (see below).
- http://localhost:8766/game — the game: one life, eighteen moments, BASELINE → CRUST → ADULTHOOD → LATER LIFE → who you became (see "The storyline"). Space / Enter = the big button, keys 1–5 pick an option, F = full screen.
- http://localhost:8766/dice.html — set up the physical die (see below).
- http://localhost:8766 — the lab: type prompts and add references by hand to tune the look. References set here carry over into the game.

## The die (optional)
**Two ways to read it.** The game uses whichever is there when the page opens:
1. `dice_reader.py`: OpenCV on the Mac, round tray, angled camera, its own window. It runs on the Mac, never on the cloud machine:
   `pip install opencv-python numpy`, then `python dice_reader.py --list-cameras`, then `python dice_reader.py --camera N`.
   Set it up in its window (c = mark the tray, l = lock, e = empty tray), THEN open the game. It tells the game on http://localhost:8767/events (`web/dice-remote.js`). Hover the DIE chip in the game to see which reader it's using.
2. The browser reader below, if dice_reader.py isn't running.

In choices, your throw is your roll against the option's target; everything else is rolled by random.org. The die is read with plain image processing in the browser (no AI, no GPU).
How: a picture of the EMPTY throwing area is remembered; after a throw, whatever differs from it is the die (table, tape, stains and glare cancel out). The top face is the die's brightest part, the dots are the holes in it.
- A webcam pointing straight down at the throwing square. Even light. A die with dark dots.
- Open http://localhost:8766/dice.html → pick the DICE CAMERA and the AVATAR CAMERA → drag a box just inside the square → take the die out and press EMPTY TRAY → throw a few times (green = what changed, box = top face, red = dots) → SAVE FOR THE GAME.
- Press EMPTY TRAY again whenever the camera moves or the light changes a lot.
- Tuning: SENSITIVITY lower if parts of the die aren't green, higher if the table turns green. TOP FACE higher if side dots get counted, lower if dots are missed.
- In the game, the DIE chip under the phases shows the die. Pick an option (click or keys 1–5), then throw. Between moments, a throw = the big button. Without a die, ROLL rolls one on screen.
- With no dice camera saved the game works as before.

## The game screen
- The look is picked on the panel (/panel → STYLE), not in the game.
- FULL SCREEN (button under the stage names, or the F key): the picture covers the whole screen edge to edge, the choices float over its bottom. Esc leaves it.

## The storyline (stage one, from stage-one-storyline.md)
One hardcoded life; chance decides how each moment goes. All the words, tables, targets, marks, modifiers, allotments and
picture descriptions are in `web/storyline.js`; the rules are in `web/game.html`. Edit storyline.js and reload; no restart.
- DEFAULT moments happen to you: random.org rolls a d6 on the moment's table (shown at the bottom), you watch.
- CHOICES: options show their target ("a 6", "5 or more", "exactly 3"). Pick one, roll your die.
  A miss: random.org rolls; 1–4 = the next easier option, 5–6 (or no easier option) = one entry from the allotment list.
- FLUKES: something small; random.org rolls; a 6 leaves a hidden MARK (NAME, RADIO, PLATFORM, TYPO). HIDDEN, POOR and RICH come from the baseline.
  Marks open exact-number options later and change some outcomes; modifiers move targets one step, never explained.
- Never shown: odds, percentages, marks. The ending reveals them: who you became (third person), the astrologer's forecast, every fluke.
- Each picture: the avatar at that age (body from the race, clothes from the outcome) + the world = the outcome's scene + place + year.
- Optional: a style reference painting per life phase (PHASE_REFS in storyline.js, images in web/refs/), so the look ages with the life.
- The look: stage one is paint only. The server starts on the "Painterly (game)" look; the panel can still switch it for tuning.

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
- STRUCTURE: what holds your body while it's repainted, through ControlNet, with a live preview of what the painter follows.
  - DEPTH (default): Depth Anything V2 small reads a depth map of each frame on the GPU (~10 ms) -> depth ControlNet.
  - POSE: the browser finds your joints with MediaPipe Pose (like the cut-out) and sends them with each frame; the server
    draws them in OpenPose's format -> OpenPose ControlNet. (The original OpenPose detector is ~100 ms+ a frame and drags in
    many libraries, so it isn't used.) The first switch to pose loads its ControlNet: a few seconds.
  - CONTROLNET STRENGTH: too high = stiff, photo-like edges; too low = melting. With a shape on, try CHANGE 0.8–1.0.
- STYLE: the LOOK (cartoon, caricature, comic, pop art, pixel art, line drawing, pencil, watercolour, oil, impressionist, woodblock, vintage poster, paper cut-out, claymation, 3D animated, low poly, stained glass, mosaic, graffiti, film noir, cyberpunk, blueprint, Matrix green code). Each look = words added to every prompt + a browser filter (pixel / line / matrix) + optionally a LoRA put in slot A. The list is styles.json: edit it (on the Mac, then ./push.sh); the panel picks up changes in a few seconds, no restart.
- STYLE, continued: two LoRA slots with weights, reference style strength (IP-Adapter), style prompt (added to every prompt), negative prompt, prompt guidance.
  Guidance 1.0 = off (fastest). The negative prompt only does something above 1.0, and then each frame costs about twice as long.
- CHANGE: how much of you is repainted; world steps (1–4).
- STYLE, reference: a STYLE REFERENCE slot (one painting for the avatar and the world) and where it acts:
  STYLE ONLY (InstantStyle: only the painter's style layers, so you get its look without its subject), STYLE + LAYOUT, or EVERYTHING.
  The layers were picked for SD 1.5 by analogy with InstantStyle's SDXL ones: judge by eye. The reference isn't saved in presets.
- STABILITY: every frame uses the same noise (the style can't wander). STEADY = how much a frame leans on the last one while you're
  still; GHOST GUARD = how quickly that lets go when you move; SKIP WHEN STILL = how much the camera must change before a new frame.
- READOUT: painter, avatar frames per second, ms per frame and WHERE IT GOES (shape, encode, painter, decode, jpeg, queued),
  NETWORK + BROWSER (the browser's round trip minus all of that), world time, GPU memory. If network + browser is bigger than the
  server's time, a bigger GPU won't help much.
- PRESETS: save / load all of the above by name (files in presets/ on the server).

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
