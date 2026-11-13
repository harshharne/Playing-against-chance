# Live generation — webcam → fast diffusion, you and the background separately

## First time only: download the models (on the cloud machine, ~6 GB, saved in ~/.cache/huggingface)
```
cd ~/stream-proto && source .venv/bin/activate && python download_models.py
```
If the download stops halfway, run it again: it carries on.

## Pages
- http://localhost:8766/panel — the tuning panel (see below).
- http://localhost:8766/game — the game: one life, 19 events, birth to death (see "The life"). Edge to edge, no bars: only the narrative box (bottom) and the cards. F = real fullscreen (the camera window hides there). Cards: hover / click, or ← → and Enter, or 1–9. No die: R or Space rolls on screen. D = a hidden debug line (die state, fps).
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
- In the game, the DIE chip under the picture says whose turn it is. Pick a card, then throw. A throw also starts a life. While the die rolls, the screen holds still. Without a die, ROLL (or R) rolls one on screen.
- With no dice camera saved the game works as before.

## The game screen
- The look is picked on the panel (/panel → STYLE), not in the game.
- FULL SCREEN (button under the stage names, or the F key): the picture covers the whole screen edge to edge, the choices float over its bottom. Esc leaves it.

## The life (trajectory.json, from H's "Life Trajectory v1")
Everything the player reads is in `trajectory.json`: the 19 events, their cards (name, the line it reveals, the target as the
player sees it: "3 or more", "a 6", "exactly 1"), the hidden Happen outcomes, the flukes, the bridge lines, the world scenes and
the timings. Edit it and the next life uses it (no restart). The rules are in `web/game.html`.
- CHOSEN: pick a card, it locks and shows its target, throw once. Hit = that card. Miss = random.org allots one of the other cards.
  Birth gives 3 throws, then the override allots. Love allots nothing: a miss means you didn't meet anyone that day.
- HAPPENS: random.org picks good, bad or neutral; only the one that happened is shown.
- FLUKES: the first job (random.org picks which small thing finds you work), and the umbrella (planted at 52, quoted back at 64).
- The unfolding: no hard cuts. Every world is painted FROM the last one (WORLD KEEPS on the panel) and crossfaded in; the
  avatar is a blend of two age descriptions, so it ages continuously as the age counts up; one text window at a time, each fading
  out fully before the next. Cards and throws wait for the player; everything else runs on the PACING timings (minimums).
- The ending: after Death and a 10 s silence, the life read back as a list (age, event, what came, what was wanted).

## The opening (Birth → Where → Whom → Body)
- Birth: the egg and sperm (web/birth.js). Where: a world map in pencil (web/worldmap.js, web/worldmap.json from Natural Earth);
  hovering a card warms its region, the drawn one fills in, an allotted one is found by a light running across the regions.
  Whom: the home built stroke by stroke, one drawing per household (web/house.js).
- Body: a Chosen event like the others (cards in trajectory.json, each with its "genes"). The baby is painted once
  (GET /portrait), then each trait emerges on it one by one (your skin first, taken from your camera; never a card),
  each repainted lightly from the last. The browser animates it (web/baby.js): breathing, blinks, eyes that follow you,
  hands and blanket moving. Then the live kid takes over: the avatar fades in while its generation ramps up (X-Ramp).
- The avatar's proportions follow its age (X-Age): below CHILD UNTIL on the panel it ignores depth and follows a pose
  reshaped to a child's, held loosely (YOUNGEST HOLD), tightening with age.

## SDXL + whole-body detection (PAINTER=sdxl)
- Live avatar: SDXL-Turbo, one step, 768x448. Worlds (1344x768) and the baby: DreamShaper XL Lightning, 4 steps.
  IP-Adapter Plus SDXL (style only uses InstantStyle's own SDXL blocks), SDXL depth + OpenPose ControlNets, TAESDXL.
- Detection: DWPose (rtmlib) on the server: body, hands and face, 133 points, feeding the OpenPose ControlNet.
  The browser keeps only its fast MediaPipe mask, to keep the avatar on you between painted frames.
- Parallax: each world gets a depth map (GET /world_depth); the page shifts near parts more than far ones as you move.
- If SDXL fails to load, the server falls back to the SD 1.5 painter by itself (the panel says why).
- The SD 1.5 LoRAs in loras/ don't work with SDXL (the panel says so if one is picked).
- One-time setup on the cloud machine: `bash setup_sdxl.sh` (installs DWPose, downloads ~20 GB, runs bench.py).
- `PAINTER=sdxl python bench.py`: time per avatar frame, world and portrait, without the browser.

## Run
On the cloud machine (chance-rtx), see CLOUD.md for the full routine:
```
cd ~/stream-proto && source .venv/bin/activate && PAINTER=sdxl python stream_server.py
```
(Leave out PAINTER=sdxl for the SD 1.5 painter.)
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
- PACING: every timing of the unfolding (arrive, settle, lock, land, miss, linger, the happen / fluke holds, chapter breath, final
  silence) and how much of each world survives into the next. Saved straight into trajectory.json; the game takes changes in ~2 s.
  It also shows roughly how long a life runs at those timings.
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

## The animation layer (animate.py, gate 1)
A painted portrait, moved live by your face: LivePortrait warps the painting the diffusion made, it never repaints it.
- http://localhost:8766/animate.html — the test page: paint a child, adult or old portrait (or upload one), look at the
  camera; R = this is my neutral face. MOVEMENT, SMOOTHING, SEND WIDTH and JPEG QUALITY change it live. The readout
  splits the round trip into the server's parts (track = face detection, motion, warp, paste, jpeg) and network + browser.
- The face detection runs on the server (InsightFace + LivePortrait's landmarks), which also reports where your head
  is (x, y, size, yaw, pitch, roll) for the parallax and whether anyone is there for the idle screen.
- Server: WebSocket /animate (frames in, [4-byte length][json][jpeg] out), POST /animate/source, GET /animate/status.
- Setup on the cloud machine: `bash setup_liveportrait.sh` (see CLOUD.md). Speed alone: `python bench_animate.py`.
- On the Mac with MOCK=1 the portrait just sways (no model); it needs `pip install "uvicorn[standard]"` for the WebSocket.

## The living world
- Between two events the world MORPHS in steps (panel: MORPH STEPS): each step is painted from the one before with
  the words moving from the old scene to the new one; the last step is the new scene and becomes the event's world.
- Inside an event it BREATHES: every few seconds (WORLD BREATHES EVERY) a new variation of the event's own world
  fades in (EACH BREATH KEEPS = how much survives). Never while the die rolls, never under the egg, map or house.
- The server prints one line per world: how long it took, what kind it was and how much it CHANGED (0 = the same
  picture, ~100 = completely different). The panel's WORLD line shows the same, or the error if a world failed;
  so does the game's hidden debug line (D).
- The parallax follows your head as found on the GPU machine (DWPose's nose in pose/both shape modes, or the
  animator's face detection), falling back to the browser's outline. GET /head says where it is.

## Portraits from the player (gate 2)
POST /portrait/from (a photo in the body, ?prompt=&strength=): the face is found, framed head and shoulders, and
repainted for the prompt. On animate.html: TAKE MY PHOTO, then PAINT ME AT 8 AGES (4 to 75); REPAINT sets how much
changes (children get a bit more). Each age can be moved live like any portrait.

## Style LoRA
train_style_lora.py trains an SDXL style LoRA on the GPU machine from a folder of images (see CLOUD.md). The SDXL
painters load LoRAs from loras/ onto both pipelines (worlds + portraits, and the live avatar).
