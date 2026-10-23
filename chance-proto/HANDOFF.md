# Playing Against Chance — handoff

Context for continuing this project in a new chat. Read this first.

## How to work with H (the person leading this)
- H leads; Claude argues, tests ideas and builds. Don't take the project over.
- One step at a time. Respond to the specific thing raised. New directions: mention them briefly, don't build on them unprompted.
- At most one suggestion per turn, labelled as a suggestion. Never present Claude's ideas as H's decisions.
- Ask one question when something is ambiguous. Keep replies compact; go deep only when asked.
- Honest, direct critique over validation.

## The project
An interactive staged installation about **predictive machines vs chance**, using a human life as the relatable context. Tone: **satirical**.
Randomness comes from **random.org** (true randomness).
Earlier versions: rock-paper-scissors vs a TRNG, a lottery with an AI character called **the Bookkeeper**, then arcade-style life stages (a sperm/egg birth game and a city-map love game).

## The trajectory so far
1. **Arcade stages → continuous trajectory.** Moved from separate stage games to a life that unfolds and accumulates consequences.
2. **Mapping the life** (decided, see below): four phases and a three-part baseline.
3. **Line prototypes (v0.1, v0.2).** v0.1 was a self-drawing line: rejected as passive, text-heavy, ugly ("where is the play?"). v0.2 was a first-person ride along the line on a white floor with bets at forks: better, but not immersive.
4. **The line is set aside.** New direction: an **avatar made from the live camera feed**, with the **background generated from the events that unfold**.
5. **Current prototype (baseline only):** birth → to whom → where & when, with a pose-driven drawn baby avatar and SD-Turbo backgrounds generated per draw. Built and tested in mock mode; H was getting it running on the Mac when the chat ended (see "Where it stopped").

## Decision log

### Decided by H
- Core: predictive machines vs chance. Life is the context. Satirical.
- Four phases: **baseline** (at birth) → **crust** (formation, up to adulthood) → **adulthood** (the richest part) → **later life** (the outcome emerges here, unscripted, "lived rather than decided").
- Baseline collapsed to three: **body** (genes, incl. sex), **home** (to whom), **world** (where + when).
- Reveal order is the lived sequence: **birth → body → home → world**.
- The unexpected ending is a **surprise of the self**: seeing what you became from a third-person view.
- Mapping first; the Bookkeeper (predictive voice) is designed later, around the map.
- The experience needs real play (arcade-level engagement), not a self-running screensaver.
- Visual direction for now: camera-feed avatar + generative backgrounds driven by events. The line is set aside.
- Oscilloscope display ruled out. CRT TV still being considered.
- Build on H's Mac (MacBook Pro M5 Pro, 24 GB). No NVIDIA GPU available.

### Open
- Choice vs drift: how much the player steers vs how much happens to them (the third-person ending depends on it).
- How the dream ("who do you dream of becoming?") is stated and how it shapes the trajectory.
- The Bookkeeper's role and personality in this version.
- What goes inside the crust, and what the crust hands over to adulthood.
- Whether the CRT TV serves the satire.
- Whether a live, constantly shifting StreamDiffusion layer is wanted (not yet tested on the Mac).
- Avatar: drawn figure that moves with you vs a diffused/generated likeness of you.

### Claude's suggestions H hasn't accepted
- Write the ending as an **obituary** (third-person summary of the life).
- Make the player's **body the betting input** (step or lean into a choice).
- Keep TouchDesigner for the installation later, not for this prototype.
- Treat the crust as geological layers (early events buried, bearing the weight of what comes later).

## Technical setup (current)
- **Mac test results:** SD-Turbo generates a 512×512 image in **0.35 s** on MPS. MediaPipe pose tracking in Chrome works; the drawn baby follows H's movements.
- **Why no StreamDiffusion yet:** real-time streaming diffusion on Apple Silicon has no published frame rates; the avatar must never stutter. Backgrounds only change at a draw, so plain SD-Turbo is enough. A live layer can be tested later.
- **Architecture:**
  - `server.py` (Python, FastAPI): stages, random.org draws (falls back to local randomness with a 30 s back-off), prompt templates, SD-Turbo generation. Serves the game. Runs on **port 8765** (8000 was taken by another server on H's Mac).
  - `web/index.html`: camera + MediaPipe pose → drawn baby avatar; egg with six numbered sperm (click or press 1–6); dice animation; cards for home and world; background crossfade; baby grows across stages; end screen with the baseline and the prompts used.
  - Content and prompts are in `server.py` under CONTENT and PROMPTS (all placeholder).
  - `MOCK=1 python server.py` runs without the image model.
- **Files on H's Mac:** `~/Downloads/chance-proto/` with a Python venv in `.venv`.

## Where it stopped
The page wasn't loading. Causes found: a different `index.html` (a "[Your Name]" site template) had been saved over the game page, and port 8000 was in use by another server. Fixes given:
1. Move `chance-index.html` into `web/` and rename it `index.html`; delete `index-3.html`.
2. Quit Terminal, then:
   ```
   cd ~/Downloads/chance-proto
   sed -i '' 's/8000/8765/g' server.py
   ls web
   source .venv/bin/activate
   python server.py
   ```
3. Open http://localhost:8765 in Chrome. The page should be white and say "Before you are anyone, chance gets three rolls."
Not yet confirmed working on the Mac.

## Next steps
1. Confirm the prototype runs end to end on the Mac.
2. Get H's reaction: does the egg-and-dice moment feel like play? Does the background change how the baby feels? How do the generated scenes look?
3. Then: tune the look of the generated scenes, decide on the avatar route, and decide whether to test a live StreamDiffusion layer.
