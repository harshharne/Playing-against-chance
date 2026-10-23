"""
Playing Against Chance · prototype brain (stages: birth -> to whom -> where & when)

What it does
  - Keeps the stages and what has been drawn so far (the life's state).
  - Rolls the dice with random.org (falls back to Python's `secrets` if offline).
  - Builds a text prompt from the state and generates the background with SD-Turbo.
  - Serves the game page from ./web

Run
  source .venv/bin/activate
  python server.py
  then open http://localhost:8765 in Chrome

Edit content in the CONTENT and PROMPTS sections below. Everything there is PLACEHOLDER.
Set MOCK=1 to run without the image model (grey placeholder images):  MOCK=1 python server.py
"""
import os
import secrets
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

import requests
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).parent
WEB = ROOT / "web"
GEN = WEB / "generated"
GEN.mkdir(parents=True, exist_ok=True)
MOCK = os.environ.get("MOCK") == "1"
IMG_W, IMG_H = 768, 512

# ============================================================== randomness
class Chance:
    """Every roll and every draw goes through here."""
    URL = "https://www.random.org/integers/?num=200&min=1&max=1000000&col=1&base=10&format=plain&rnd=new"

    def __init__(self):
        self.buf, self.source, self.lock = [], "not yet used", threading.Lock()
        self.retry_at = 0  # after a failure, don't hammer random.org

    def _refill(self):
        if time.time() < self.retry_at:
            return
        try:
            r = requests.get(self.URL, timeout=6)
            r.raise_for_status()
            self.buf.extend(int(x) for x in r.text.split())
            self.source = "random.org"
        except Exception as e:  # offline, quota used up, etc.
            print(f"[chance] random.org unreachable ({type(e).__name__}); using local randomness for 30 s")
            self.source = "pseudo"
            self.retry_at = time.time() + 30

    def random(self):
        """A number in [0, 1) and where it came from."""
        with self.lock:
            if not self.buf:
                self._refill()
            if self.buf:
                return (self.buf.pop(0) - 1) / 1_000_000, "random.org"
        return secrets.randbelow(1_000_000) / 1_000_000, "pseudo"

    def dice(self):
        x, src = self.random()
        return int(x * 6) + 1, src

    def weighted(self, table):
        total = sum(w for _, w in table)
        r = self.random()[0] * total
        for value, w in table:
            r -= w
            if r < 0:
                return value
        return table[-1][0]


CHANCE = Chance()

# ============================================================== content (PLACEHOLDER)
CONTENT = {
    "body": {
        "sex": [("a girl", 49), ("a boy", 51)],
        "health": [("robust", 30), ("ordinary", 55), ("fragile", 15)],
        "temperament": [("restless", 1), ("steady", 1), ("anxious", 1), ("stubborn", 1), ("dreamy", 1)],
        "aptitude": [("numbers", 1), ("words", 1), ("hands", 1), ("people", 1), (None, 1.5)],
    },
    "home": {
        "economy": [("scraping by", 30), ("getting by", 40), ("comfortable", 22), ("wealthy", 8)],
        "stability": [("steady", 55), ("strained", 32), ("broken", 13)],
        "order": [("only child", 15), ("eldest of two", 30), ("middle of three", 25), ("youngest of four", 30)],
    },
    "world": {
        "place": [("village", 35), ("small town", 25), ("city", 25), ("metro", 15)],
        "region": [(r, 1) for r in ["Gujarat", "Bihar", "Kerala", "Punjab", "Maharashtra", "Assam"]],
        "era": [((1950, 1969), 1), ((1970, 1989), 1.3), ((1990, 2009), 1.4)],
    },
}

STAGES = [
    {"id": "birth", "question": "Six of you. One gets born.", "hint": "Pick one. The dice decides."},
    {"id": "home", "question": "To whom?", "hint": "Pick a home. The dice decides."},
    {"id": "world", "question": "Where, and when?", "hint": "Pick a place. The dice decides."},
]


def draw_option(stage):
    """Draw one of the six options for a stage (each is a full possible baseline)."""
    w = CHANCE.weighted
    if stage == "birth":
        c = CONTENT["body"]
        b = {k: w(c[k]) for k in c}
        reveal = ", ".join(x for x in [b["sex"], b["temperament"],
                                       "fragile" if b["health"] == "fragile" else None,
                                       f"good with {b['aptitude']}" if b["aptitude"] else None] if x)
        return {"value": b, "label": "sealed", "reveal": reveal, "icon": "seed"}
    if stage == "home":
        h = {k: w(v) for k, v in CONTENT["home"].items()}
        return {"value": h, "label": f"{h['economy']} · {h['order']}", "reveal": f"a family {h['economy']}, {h['order']}", "icon": "house"}
    if stage == "world":
        c = CONTENT["world"]
        lo, hi = w(c["era"])
        wd = {"place": w(c["place"]), "region": w(c["region"]), "year": lo + int(CHANCE.random()[0] * (hi - lo + 1))}
        icon = {"village": "tree", "small town": "house", "city": "tower", "metro": "train"}[wd["place"]]
        return {"value": wd, "label": f"{wd['place']} · {wd['region']} · {wd['year']}", "reveal": f"{wd['place']}, {wd['region']}, {wd['year']}", "icon": icon}
    raise ValueError(stage)

# ============================================================== prompts (PLACEHOLDER)
STYLE = "simple black ink line drawing on white paper, hand-drawn, minimal, lots of white space"
HOME_SCENE = {
    "scraping by": "a crowded one-room home with a tin roof and a single bare bulb",
    "getting by": "a small two-room home with a steel cupboard and a ceiling fan",
    "comfortable": "a tidy apartment with a sofa, bookshelves and a balcony",
    "wealthy": "a large bungalow with a garden, a gate and a parked car",
}
FAMILY = {
    "only child": "young parents holding a newborn",
    "eldest of two": "young parents holding a newborn",
    "middle of three": "parents, one small child and a newborn",
    "youngest of four": "parents, three children and a newborn",
}
MOOD = {"steady": "a calm, warm mood", "strained": "a tense, quiet mood", "broken": "an empty chair at the table, a heavy mood"}
PLACE = {
    "village": "in a village, fields and a dirt road outside",
    "small town": "in a small town, a busy bazaar street outside",
    "city": "in a city, apartment blocks and traffic outside",
    "metro": "in a huge metro city, high-rises and a flyover outside",
}


def era_details(year):
    if year < 1960: return "1950s, a valve radio, bicycles"
    if year < 1970: return "1960s, a transistor radio, an old Ambassador car"
    if year < 1980: return "1970s, a rotary telephone, scooters"
    if year < 1990: return "1980s, a television with a rooftop antenna, a cassette player"
    if year < 2000: return "1990s, cable TV, a landline phone"
    return "2000s, mobile phones, a desktop computer"


def build_prompt(state, stage):
    h = state.get("home")
    if stage == "home" and h:
        return f"{HOME_SCENE[h['economy']]}, {FAMILY[h['order']]}, {MOOD[h['stability']]}, {STYLE}"
    if stage == "world" and h and state.get("world"):
        wd = state["world"]
        return (f"{HOME_SCENE[h['economy']]} {PLACE[wd['place']]}, {wd['region']}, India, {wd['year']}, "
                f"{era_details(wd['year'])}, {FAMILY[h['order']]}, {STYLE}")
    return None

# ============================================================== image model
PIPE, PIPE_ERR, PIPE_LOCK = None, None, threading.Lock()


def load_model():
    global PIPE, PIPE_ERR
    if MOCK:
        print("[model] MOCK mode: no image model")
        return
    try:
        import torch
        from diffusers import AutoPipelineForText2Image
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        print(f"[model] loading SD-Turbo on {device}…")
        p = AutoPipelineForText2Image.from_pretrained("stabilityai/sd-turbo", torch_dtype=torch.float16, variant="fp16").to(device)
        p.set_progress_bar_config(disable=True)
        p("warm up", num_inference_steps=1, guidance_scale=0.0, width=IMG_W, height=IMG_H)
        PIPE = p
        print("[model] ready")
    except Exception as e:
        PIPE_ERR = str(e)
        print(f"[model] failed to load: {e}")


def generate(prompt, seed, path):
    if MOCK or PIPE_ERR:
        from PIL import Image, ImageDraw
        img = Image.new("RGB", (IMG_W, IMG_H), "white")
        d = ImageDraw.Draw(img)
        d.rectangle([20, 20, IMG_W - 20, IMG_H - 20], outline=(200, 200, 200), width=2)
        d.text((40, 40), prompt[:110], fill=(120, 120, 120))
        img.save(path)
        return
    t0 = time.time()
    while PIPE is None and not PIPE_ERR and time.time() - t0 < 120:
        time.sleep(.2)
    if PIPE is None:
        raise HTTPException(503, f"image model not available: {PIPE_ERR}")
    import torch
    g = torch.Generator("cpu").manual_seed(seed)
    with PIPE_LOCK:
        img = PIPE(prompt, num_inference_steps=1, guidance_scale=0.0, width=IMG_W, height=IMG_H, generator=g).images[0]
    img.save(path)

# ============================================================== game sessions
SESSIONS = {}
app = FastAPI()


class Req(BaseModel):
    sid: str
    pick: Optional[int] = None   # 1..6, the player's bet


def stage_payload(s):
    st = STAGES[s["stage"]]
    return {"sid": s["sid"], "stage": st["id"], "index": s["stage"], "question": st["question"], "hint": st["hint"],
            "options": [{"n": i + 1, "label": o["label"], "icon": o["icon"]} for i, o in enumerate(s["options"])]}


@app.post("/api/start")
def start():
    sid = uuid.uuid4().hex[:10]
    s = {"sid": sid, "stage": 0, "state": {}, "bets": [], "seed": secrets.randbelow(2**31)}
    s["options"] = [draw_option("birth") for _ in range(6)]
    SESSIONS[sid] = s
    return stage_payload(s)


@app.post("/api/roll")
def roll(req: Req):
    s = SESSIONS.get(req.sid)
    if not s or "rolled" in s:
        raise HTTPException(400, "no open stage to roll")
    stage = STAGES[s["stage"]]["id"]
    n, src = CHANCE.dice()
    chosen = s["options"][n - 1]
    key = {"birth": "body", "home": "home", "world": "world"}[stage]
    s["state"][key] = chosen["value"]
    s["bets"].append(req.pick == n)
    s["rolled"] = True
    prompt = build_prompt(s["state"], stage)
    image = None
    if prompt:
        path = GEN / f"{s['sid']}_{stage}.png"
        generate(prompt, s["seed"], path)
        image = f"/generated/{path.name}?t={int(time.time() * 1000)}"
    return {"dice": n, "source": src, "win": req.pick == n, "reveal": chosen["reveal"],
            "pick_reveal": s["options"][req.pick - 1]["reveal"] if req.pick and stage == "birth" else None,
            "prompt": prompt, "image": image, "state": s["state"], "last": s["stage"] == len(STAGES) - 1,
            "bets": {"won": sum(s["bets"]), "total": len(s["bets"])}}


@app.post("/api/next")
def next_stage(req: Req):
    s = SESSIONS.get(req.sid)
    if not s or "rolled" not in s:
        raise HTTPException(400, "roll first")
    if s["stage"] >= len(STAGES) - 1:
        raise HTTPException(400, "life prototype finished")
    s["stage"] += 1
    s.pop("rolled")
    s["options"] = [draw_option(STAGES[s["stage"]]["id"]) for _ in range(6)]
    return stage_payload(s)


@app.get("/api/status")
def status():
    return {"model": "mock" if MOCK else ("ready" if PIPE else ("error: " + PIPE_ERR if PIPE_ERR else "loading")),
            "randomness": CHANCE.source}


app.mount("/generated", StaticFiles(directory=GEN), name="generated")


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")


app.mount("/", StaticFiles(directory=WEB), name="web")

if __name__ == "__main__":
    threading.Thread(target=load_model, daemon=True).start()
    print("\n  Open http://localhost:8765 in Chrome\n")
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
