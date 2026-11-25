# Live generation — webcam → fast diffusion, you and the background separately


Type: two typefaces, one for the EVENTS (the event's name, what happened, the die's number) and one for the
OPTIONS (the cards, the one you pick, what chance gave instead), chosen on /panel (Event font, Option font), in both
styles. Default: Noto Serif Display + IBM Plex Mono (a ledger's hand). All bundled in web/fonts (web/typefaces.js).

Tests: `bash tests/run.sh` (quick, ~6 min) or `bash tests/run.sh full` (+ a soak of several lives in one page).
No GPU or keys needed; see tests/README.md.

## First time only: download the models (on the cloud machine, ~6 GB, saved in ~/.cache/huggingface)
```
cd ~/stream-proto && source .venv/bin/activate && python download_models.py
```
If the download stops halfway, run it again: it carries on.

## Pages
- ./show.sh on / off — the whole show from the Mac in one window (see CLOUD.md): starts and watches the machine,
  keeps the tunnel up, restarts what falls over. ./show.sh setup once first.
- http://localhost:8766/start — the run sheet: links to every page, the server and die-reader lights, and the ON / OFF steps
  with copy buttons (prints as an A5 booklet; double-click web/start.html when the server is off).
- http://localhost:8766/panel — the control panel: runs the show live, and every setting (see below).
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
- The screen is OFF (black, no words, no cursor) until a throw: the die, R / Enter, or ROLL on /panel. Then it comes
  up over WAKE IN seconds on the first world (painted while it was dark), the voice comes in, and your photo is taken
  once the screen lights your face. After a life the ledger stays LEDGER STAYS seconds, then the screen goes black
  again (0 = it stays until a throw); a throw while the ledger is up goes dark and starts the next life at once.
  Both timings are on /panel → PACE → THE SCREEN. The panel shows "screen off" while it waits.
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
- The unfolding: no hard cuts. The world is always on its way from one place to the next (see "The living world"); the
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
- `PAINTER=sdxl python bench.py`: time per avatar frame, per world picture (fresh, in-between, last) and portrait,
  without the browser. It also says the lowest ONE PICTURE EVERY the GPU can keep up with.

## Run
On the cloud machine (chance-rtx), see CLOUD.md for the full routine:
```
cd ~/stream-proto && source .venv/bin/activate && PAINTER=sdxl python stream_server.py
```
(Leave out PAINTER=sdxl for the SD 1.5 painter.)
Then on the Mac, through the tunnel: http://localhost:8766/game (the game), http://localhost:8766 (the lab), http://localhost:8766/panel (control).

## The lab (http://localhost:8766)
- YOU / BACKGROUND: a prompt for each, press Enter. Either can be left empty.
- STYLE / IMAGE slots next to each prompt: click or drag an image in; × removes it. They feed IP-Adapter (strength on the panel).
  The background IMAGE becomes the starting picture, re-imagined by the prompt.
- LOOK: a browser filter over everything (8-bit, line drawing, or as generated).
- When you stand still, no new frames are made, so a still you stays perfectly still. Every Enter makes a new background.

## The control panel (http://localhost:8766/panel)
Open it next to the game (another window, or a laptop on the same tunnel). Everything saves on the server and reaches the
running game within a second; nothing needs a restart. Top right: NOTES shows what every control does (hidden by default,
so the panel stays quiet), LIGHT / DARK (dark for the room; both remembered in that browser). The big card on the left is
the game now: its age in dot-matrix numbers, its colour the state (warm = a life running, blue = paused, grey = screen off). The bar on top: SERVER (painter), ANIMATOR, DIRECTOR, GAME (green =
fine, amber = loading or waiting, red = off or failing; hover the animator for why).
- THE SHOW, on the left, acts on the game now (through POST /game/command and /game/live; the game polls
  GET /game/commands and reports back to /game/report every second, GET /game/state is what the panel reads):
  - what the game is on: age, moment n of N, the event, the style and avatar, the screen's frame rate, what is being
    painted, and any warning (no portrait, the director failing, a slow screen).
  - NEW LIFE (press twice: a stray click never ends a life), PAUSE / RESUME (every wait in the game holds; the world
    and the portrait keep moving), ROLL (a random.org throw for the player when the die is away), REDRAW WORLD.
  - STYLE OF THE SCREEN glass / fog (a switch in the middle of a choice waits until the choice is over; U in the game
    tells the panel too), AVATAR portrait / painted (at the next event), DIRECTOR on / off.
  - TEMPO: every timing at once (0.7 = faster, 1.3 = slower; cards and die still wait for the player). TYPE SIZE: the
    fog style's letters, all together. Both are kept in game_live.json on the server (git ignores it).
- The tabs:
  - PACE: every timing of a life, in seconds, and how long a life runs at them (with the tempo). Saved into trajectory.json.
  - WORLD: how far the world moves (what each kind of change keeps, the PASSAGE: a scene every / each takes / each keeps,
    one picture every, most pictures), one life one look (layout hold, palette hold, breath drift), how the change looks
    (dissolve, push in, parallax), speed and the GPU (in-between steps, REST BETWEEN PICTURES: raise it if the portrait
    stutters while the world changes).
  - STYLE: the look (styles.json), two LoRA slots with weights, a style reference painting (style only / style and
    layout / everything), style prompt, negative prompt, guidance (1.0 = off; the negative prompt needs more, and the
    painted avatar then costs about twice as long).
  - AVATAR: the portrait's movement (movement, head smoothing, face smoothing, turn limit), sent to the animator live;
    the painted avatar's shape (depth / pose / both, ControlNet strength, child until, youngest hold, change) and
    steadiness (steady, ghost guard, skip when still).
  - DIRECTOR: its lines on screen, how long to wait for it, its calls and errors, and its last answer: each moment's
    world and the passage it wrote.
  - SYSTEM: the readout (painter, frames, where the time goes, network, world run, GPU memory) and PRESETS (every
    painting setting by name, files in presets/).
- The camera preview that used to be on the panel is gone: the panel is for running the show.

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

## The ever-changing world (WORLD RULES: ever-changing, the default)
Life isn't continuous: it jumps, it repeats, things come in from outside. So the background never settles into one
picture morphing into the next. web/worldclock.js runs it; chance rolls everything, from ONE random.org draw per life:
- WHAT: a fragment from the event's POOL: its places (the scene and its passage), its objects and people
  (trajectory.json "objects" / "people" on each event), the weather (context.weather), the times coming in from
  outside the life (context.intrusions, by age), and MEMORIES (earlier moments of this life coming back, more often as
  you age). The director writes 8-12 more for each arrival ("pool"); the written ones always fill the rest.
- HOW: a shot (wide, close-up, detail, from above, through a window, reflected, silhouette, empty, crowded, from low).
  LIGHT: the light of your age most of the time, sometimes any time of day; sometimes weather.
- WHEN: a gap of about SHORT GAP to LONG GAP seconds (panel, WORLD), mostly short, now and then a burst of quick
  pictures or a long hold; x TEMPO; slower while you choose; frozen while the die rolls; nothing while paused or dark.
- CHANGE: a cut, a quick dissolve or a slow patchy one. MOVE: each picture drifts on its own while it is up (a push
  in, a pull out, a slide), in depth (panel, WORLD: MOVE).
- Every picture is painted on its own from its own noise (POST /world with shot: true): no layout or colour held
  over. Shots never cancel each other and wait while a change is painted. Two are painted AHEAD at full quality and
  shown when their time comes: the screen never goes blank and never shows a rough picture. If the painter is slow or
  gone, the picture on screen stays (drifting) and the clock backs off, then carries on.
- ARRIVING at an event: a wide shot of its scene comes in slowly. An OUTCOME is the one continuous moment: the world
  turns into what happened from the picture on screen (as below), then the pictures go on in its air.
- Prompts stay short (about 40 words: shot, thing, place, light, weather); the LoRA's trigger words go first.
- The look: "mine" in styles.json is your LoRA (mylook-early, else mylook, from loras/ on the GPU machine); the server
  starts in it when the file is there, else in painterly.
- CONTINUOUS (WORLD RULES on the panel) is the earlier way, below, kept for comparing on the GPU. Switching takes
  effect at once.

## The living world (WORLD RULES: continuous)
- A CHANGE (arriving at an event, or the world turning into what happened) is painted as a run of pictures, streamed
  as they're made (POST /world: each message is [length][json][jpeg][depth jpeg]). All of them start from the picture
  on screen and use the same noise; each is repainted a little more than the one before (from 30% up to 1 - KEEPS)
  while the words move from the old scene to the new. The in-between pictures take 2 steps and the tiny decoder
  (IN-BETWEEN STEPS); the last one is full quality and becomes the moment's own world.
- The page queues the pictures and dissolves through them (web/parallax.js): the new one soaks in in soft patches,
  the far parts first (DISSOLVE), the view pushing in through the run (PUSH IN), all in parallax with your head. A
  fade that has started always finishes, so nothing jumps; a newer change only drops the pictures not yet shown.
- PACE: the change between two events takes ARRIVE + ARRIVE: PER YEAR x the years that pass (at least CHAPTER BREATH
  after a chapter), so a decade takes longer than a year and the life sets the tempo. An outcome turns in over WORLD
  TURNS. One picture per ONE PICTURE EVERY seconds of a change, at most MOST PICTURES.
- ONE LIFE, ONE LOOK: the look's words go FIRST in every prompt (the painter reads 77 tokens; the end is what gets cut,
  and the server warns when a prompt is that long). Each life has one seed: LAYOUT HOLD of every world's noise is the
  life's own, so places rhyme. PALETTE HOLD leans each world's colours toward the life's running colours.
- CONTEXT (trajectory.json "context"): the game adds to every written scene where you were born (Where), what the
  family had (Whom, "means", until 24), the light of your age (a life as one day: dawn at birth, night at the end;
  a scene that names its own light keeps it), and after a Happens, the air (good: clear; bad: a grey sky). The
  director gets the same context and writes it in itself.
- Inside an event the life MOVES ON: every event in trajectory.json has a PASSAGE, 2-5 scenes of the years until the
  next event (school: the yard in rain, a classroom in winter, a bus home at dusk ...). Every PASSAGE: A SCENE EVERY
  seconds the next one is painted in as a change of its own (PASSAGE: EACH TAKES, so several pictures, never a jump),
  each keeping PASSAGE: EACH KEEPS of the last. The director rewrites the passage for this life (4-6 scenes). When the
  passage is over the last scene BREATHES (small variations, BREATH DRIFT). Never during a change or the words between
  events, never while the die rolls, never under the egg, map or house.
- Scenes are written as things a painter can paint: no readable writing (notices, signs saying X): it comes out as
  scribble. Several were rewritten for that.
- The server prints one line per picture ([world N] change 3/6 · time · how much repainted · how far the words are).
  The panel's WORLD line shows the last change (pictures, time each), errors, and a warning if a prompt is too long;
  so does the game's hidden debug line (D).
- The parallax follows your head as found on the GPU machine (DWPose's nose in pose/both shape modes, or the
  animator's face detection), falling back to the browser's outline. GET /head says where it is.

## The screen's two styles (U switches; the browser remembers)
- GLASS: the soft narrative window, glass cards, the die in a disc (as before).
- FOG (web/ui-fog.js): a clean sheet. Dark torn edges, a white fog drifting inside them, the painted world showing
  through the middle. No boxes and no narrative window: only letters. The event's name is called out, the options come
  up along the bottom, the one you pick is set in the middle with its throw ("throw 3 or more"), the die's number lands
  alone, then hit or miss; what chance gave instead forms slowly out of the fog ("allotted"). What happened is shown
  in a line of serif; the bridge lines, setups and card descriptions are not shown: the voice says them.
- The lettering: one high-contrast display serif, Noto Serif Display (it has true narrow widths, so nothing is
  squeezed). Titles of two lines: the first heavier, the second light and tracked out, one letter drawn at the
  narrowest width and much taller, crossing between them. One-line words: a tall initial. Options: a smaller tall
  initial. Font in web/fonts (OFL), so no internet is needed.
- The fog moves: it rolls and curls, its edges breathe, wisps drift over the picture, and at every change of place it
  thickens over the middle and clears as the new place forms (SWELL in ui-fog.js).
- In the fog the portrait stands in the middle too, a little smaller.
- Legibility: every line is fitted to the screen (a long option or title shrinks before it would run off), the options
  sit on one fog bank, more than five options go on two rows, and TYPE SIZE on the panel scales it all.
- A switch during a choice waits until the choice is over.
- Every line the game would show also fires a `pac-say` browser event {k, t, s, cls, shown}, in both styles.

## The avatar: you, as a portrait at every age (AVATAR = portrait on /panel, the default)
- Your photo is taken when the life begins (the BEGIN throw: you're at the screen). Each event's age is painted from it
  ahead of time (POST /portrait/from: this life's seed, so all ages look like one person; your clothes from Whom and
  the outcomes; what the Body throw gave you). Children are repainted more (0.75) than adults (0.6).
- WHOSE FACE (HERITAGE on /panel): a mix of your photo and the birthplace's people. Each Where card has a heritage
  ("East Asian"); it goes first in every face prompt, the baby's included: "a 23-year-old man of mixed East Asian
  heritage". 0 = yours (the photo alone, repainted less), 0.5 = the mix (default), 1 = the birthplace's (repainted more).
  Your skin isn't read from the camera's brightness any more (the venue's light made everyone pale): it comes from the
  photo, with the birthplace's mixed in. Changes show from the next portrait.
- The animator (LivePortrait) moves the portrait with your face. It is cut out of its plain background (MediaPipe, in
  the browser) and stands at the bottom of the world, in the middle, growing with your age.
- BODY on /panel (web/bodywarp.js): the animator moves the face; the browser bends the rest of the painting to follow
  your body (MediaPipe Pose on the camera, ~30 a second, mirrored like the screen):
  - BODY + ARMS (default): portraits are painted waist up ("arms hanging relaxed at the sides"). The chest leans, sways
    and grows a little as you lean in (against where you usually stand: reset at every event, then following you
    slowly). An arm that hangs free at the side follows yours (upper arm and forearm, against your shoulder line),
    drawn as its own layer over the body. An arm painted across the body, on the lap or holding something stays painted
    on (moving it would leave a second arm behind): the D line says which arms move ("moves", "arm in front of the
    body", "forearm not hanging").
  - BODY LEANS: waist up, the chest moves, the arms don't. STILL: head and shoulders, as before.
  - It is a 2D puppet of the same painting, so the face and clothes can't change. It can't do fingers or a body turning
    away; a raised arm is rigid and shows a hard edge at the shoulder. If the pose reader or WebGL isn't there, or no
    shoulders are found in the portrait, the portrait stands still.
  - The framing changes at the next age (a new portrait is painted); the movement switches at once.
- As the years pass you DISSOLVE into the next age: the server moves both portraits with the same motion
  (/animate/source?slot=next, then {"cmd":"promote"}), so both faces are alive while one becomes the other. A new
  portrait is only painted when the age moves 3+ years or the clothes change.
- The baby (Body) hands over to your portrait at the next event's age. If no portrait can be made (no face in the
  photo, the animator didn't load), that life falls back to the painted avatar by itself; the debug line (D) says so.
- AVATAR = painted: the older avatar, the camera repainted frame by frame by SDXL-Turbo.

## Portraits from the player (gate 2)
POST /portrait/from (a photo in the body, ?prompt=&strength=): the face is found, framed head and shoulders, and
repainted for the prompt. On animate.html: TAKE MY PHOTO, then PAINT ME AT 8 AGES (4 to 75); REPAINT sets how much
changes (children get a bit more). Each age can be moved live like any portrait.

## Style LoRA
train_style_lora.py trains an SDXL style LoRA on the GPU machine from a folder of images (see CLOUD.md). The SDXL
painters load LoRAs from loras/ onto both pipelines (worlds + portraits, and the live avatar).

## The director (an LLM writes each moment's world)
director.py + director.json. For every moment of the life it writes, from the life so far: the WORLD prompt (your
written scene elaborated: light, weather, season, viewpoint, things that carry over), the PASSAGE (4-6 scenes of the
years until the next event, from the author's passage), for arrivals a POOL of 8-12 fragments for the ever-changing
world, CLOTHES when the moment changes them, and one quiet LINE. The written trajectory stays the
spine and the fallback: off, too slow (WAIT FOR IT UP TO), or failing its checks (director.json never_in_pictures,
word limits) -> the written scene. It never decides anything; chance does.
- Asked AHEAD: the next event's arrival as soon as this one's outcome is known, and all of an event's branches as it
  begins, so answers are there when the die lands. About 2 calls per event (~40 a life), cached.
- Key: anthropic.key in stream-proto/ on the Mac (one line; git ignores it; push.sh sends it), or ANTHROPIC_API_KEY.
- Model and rules: director.json (re-read on every call, no restart). Default claude-sonnet-5-5.
- Claude Sonnet 5.5 refuses a forced tool call, so newer models answer as structured JSON (output_config json_schema,
  low effort); older models (OLD_STYLE in director.py) keep the tool call. "api": "tool" / "json" in director.json forces one.
- Panel: DIRECTOR on/off (left), and the DIRECTOR tab: its lines, WAIT FOR IT UP TO, calls / cached / rejected / errors,
  its last answer. The server prints each answer ([director] lines).
- For the Bookkeeper (Voice Lab): the game fires a `pac-moment` browser event with {key, line, world, written} each
  time a directed moment is used.

## Sound (web/sound.js, Tone.js)
Everything is made in the browser with Tone.js (MIT, kept in web/vendor/, so it works offline): no sound files needed.
Three layers under the voice:
- BED: the life's slow chord. Its register and mode move with the age (bright lydian in childhood, ionian in youth,
  dorian, aeolian, a sparse phrygian in old age); a hit opens it, a miss or a bad turn bends it (a low drone comes in).
- PLACE: each scene's sound, picked from its words (or the director's sound tags): room, fan, murmur, crowd, children,
  street (with horns), rain, wind, birds (with a koel), night (crickets), train, water, clock, kitchen, bells, typing,
  hospital. Up to three at once, cross-fading with the picture. A recording can replace any of them: web/sounds/.
- CUES: options rising (a note each), the choice locking, the screen's throw, the die landing (each number its own
  note, then a fifth for a hit or a rub for a miss), the years ticking past, a new event.
Rules: the voice wins (bed and place drop under it: UNDER THE VOICE on the panel); the black screen and the end of a
life are silent; PAUSE silences it. Browsers allow sound only after a click: click the game once (the voice needs it too).
Panel: SOUND on/off (left) and the SOUND tab (levels, what's playing). Hear every sound alone: /sound-lab.html.

## The Bookkeeper: the voice in the room (bookkeeper.md, bookkeeper.json, web/bookkeeper.js)
An omnipresent voice that carries the life: no narrative box while it's there. OpenAI Realtime, speech to speech. The
browser talks to OpenAI directly (WebRTC); the server only mints a short-lived key per life (GET /voice/token), so the
real key never leaves the cloud machine.
- Key: openai.key in stream-proto/ on the Mac (one line; git ignores it; push.sh sends it), or OPENAI_API_KEY.
  Restart the server once after adding bookkeeper.py (push.sh says so). No key: the game runs with text, as before.
- The personality: bookkeeper.md (from the personality map). The settings: bookkeeper.json (model, voice, accent,
  predict_player, show_text, mic, ...). Both are read fresh when a life begins: edit, push, start a new life.
- WHEN it speaks is the game's: three moments per event, each a [GAME] message with the facts it must carry.
  ARRIVE (the bridge retold + what's coming, while the world changes) · CARDS (its opinion while they rise) ·
  OUTCOME / HAPPENED (what happened, plainly, then its take). A fluke is one flat line. After Death it closes the
  books, then the ledger shows. Silent during the lock, the throw and the landing.
- The player can talk to it any time except the throw, and pick a card by saying its name (the choose_card tool;
  a card named while the cards are still rising is taken once they're up). Clicks, keys and the die work as before.
- The game waits for each line to finish (at most max_wait_s) before the next beat, so the pacing timings are
  minimums, as before.
- A new voice session per life: it remembers nothing of the last player.
- Every line said and heard goes to logs/voice-<date>.jsonl on the server, with the prompt's version.
- It is heard, never seen: nothing on screen stands for the voice (no orb, no waveform, no motif). In the glass style
  the narrative box steps back while it speaks; the fog style already shows only the event and the options.
- In both styles: the fog's options can be picked by voice as well (a name said while they rise is taken once they're up).
- Panel: the VOICE chip (said / heard, or why it's off: hover), VOICE on / off (off stops it at once and the words come
  back on screen; on starts with the next life), WORDS: as set (bookkeeper.json show_text) / on screen / voice only,
  and its last line under the event. PAUSE also stops it mid-line.
- The panel's VOICE tab (saved with the game's live settings): which moments it speaks at (a moment switched off
  is silent, but it still learns what happened), line length (its word limits x this), whether it answers the player,
  speed, volume, a breath before each line: all at once. Voice, accent, model, calling the player's pick, mic and
  how long it waits for the player: from the next life, over bookkeeper.json ("As set" = the file).
- The debug line (D) shows the voice: ready / connecting / off (why), lines said and heard.
- Sound: Chrome may block it until the first click or key. For the installation, start Chrome with
  --autoplay-policy=no-user-gesture-required. The mic uses Chrome's echo cancellation; with speakers in a room,
  set "mic": "far_field".
