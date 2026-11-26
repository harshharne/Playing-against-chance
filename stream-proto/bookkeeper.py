"""
The Bookkeeper: the voice in the room (OpenAI Realtime, speech to speech).

The browser talks to OpenAI directly over WebRTC, with a short-lived key this server mints (GET /voice/token): the
real key never leaves this machine. The personality is bookkeeper.md, the settings bookkeeper.json; both are re-read
for every life, so edits show up on the next life without a restart.

The game decides WHEN it speaks: it sends a [GAME] message at each moment (arrive, cards, outcome, happened, fluke,
close) and asks for one spoken answer. The voice never decides anything: the die and random.org do.
Key: OPENAI_API_KEY, or openai.key next to this file (kept out of git; push.sh sends it).
"""
import datetime
import hashlib
import json
import os
import re
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
API = "https://api.openai.com/v1/realtime/client_secrets"
LOGS = os.path.join(HERE, "logs")


class VoiceError(Exception):
    pass


def read_key():
    k = os.environ.get("OPENAI_API_KEY", "").strip()
    if k:
        return k
    try:
        with open(os.path.join(HERE, "openai.key")) as f:
            return f.read().strip()
    except OSError:
        return ""


def read_settings():
    with open(os.path.join(HERE, "bookkeeper.json"), encoding="utf-8") as f:
        return {k: v for k, v in json.load(f).items() if not k.startswith("_")}


def read_instructions(s):
    with open(os.path.join(HERE, "bookkeeper.md"), encoding="utf-8") as f:
        text = f.read()
    if not s.get("predict_player"):                       # the "calling the player" part only when it's switched on
        text = re.sub(r"<!-- predict -->.*?<!-- /predict -->\n?", "", text, flags=re.S)
    text = text.replace("<!-- predict -->\n", "").replace("<!-- /predict -->\n", "")
    accent = str(s.get("accent") or "").strip()
    return text.replace("{accent}", f"- {accent}" if accent else "").strip() + "\n"


CHOOSE_CARD = {
    "type": "function",
    "name": "choose_card",
    "description": "Pick the card the player has clearly chosen, by saying its name. Only while the cards are up, and "
                   "only when the player commits to one. Never pick for them.",
    "parameters": {
        "type": "object",
        "properties": {"card": {"type": "string", "description": "the card's name, as the player said it"}},
        "required": ["card"],
    },
}


# ---------- the panel's Voice tab (kept in the game's live settings, "bk") ----------
# Live: the game applies these at once. From the next life: they go into the session when a life begins, over
# bookkeeper.json ("" = as bookkeeper.json says).
VOICES = ("cedar", "marin", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "alloy")
MOMENTS = ("arrive", "cards", "outcome", "fluke", "close")
INDIAN = ("Speak English with a light Indian accent. Keep it steady from the first word to the last, don't exaggerate "
          "it, and keep it easy to understand.")
PANEL_DEFAULTS = {
    # live
    "speed": 1.0,           # how fast it talks (OpenAI's range is 0.25-1.5; the panel keeps to 0.7-1.3)
    "volume": 1.0,          # 0-1, in the browser
    "length": 1.0,          # its lines' word limits x this (0.5 = terse, 1.5 = it takes its time)
    "breath": 0.4,          # seconds of silence before each line (a beat after the world changes, before it speaks)
    "moments": {m: True for m in MOMENTS},   # which moments it speaks at (off: it still learns what happened, silently)
    "talk_back": True,      # it answers the player when they speak
    # from the next life
    "mic": "", "listen": "",   # at once too (the game sends them to the running session)
    # from the next life
    "voice": "", "accent": "", "model": "", "predict": "",
}


def clean_panel(b):
    """The panel's voice settings, made safe; anything unknown falls back to its default."""
    out = json.loads(json.dumps(PANEL_DEFAULTS))
    for k, lo, hi in (("speed", 0.6, 1.4), ("volume", 0.0, 1.0), ("length", 0.4, 1.8), ("breath", 0.0, 3.0)):
        try:
            out[k] = round(max(lo, min(hi, float(b.get(k, out[k])))), 2)
        except (TypeError, ValueError):
            pass
    m = b.get("moments") if isinstance(b.get("moments"), dict) else {}
    out["moments"] = {k: bool(m.get(k, True)) for k in MOMENTS}
    out["talk_back"] = bool(b.get("talk_back", True))
    for k, allowed in (("voice", ("",) + VOICES), ("accent", ("", "neutral", "indian")), ("model", ("", "best", "fast")),
                       ("predict", ("", "on", "off")), ("mic", ("", "near", "far")), ("listen", ("", "low", "medium", "high"))):
        out[k] = b.get(k) if b.get(k) in allowed else ""
    return out


def with_panel(s, p):
    """bookkeeper.json's settings, with the panel's next-life choices over them."""
    p = clean_panel(p or {})
    s = dict(s)
    if p["voice"]:
        s["voice"] = p["voice"]
    if p["accent"]:
        s["accent"] = INDIAN if p["accent"] == "indian" else ""
    if p["model"]:
        s["model"] = "gpt-realtime-2.1" if p["model"] == "best" else "gpt-realtime-2.1-mini"
    if p["predict"]:
        s["predict_player"] = p["predict"] == "on"
    if p["mic"]:
        s["mic"] = f"{p['mic']}_field"
    if p["listen"]:
        s["listen_eagerness"] = p["listen"]
    s["speed"] = p["speed"]
    return s


def session(s, instructions):
    out = {
        "type": "realtime",
        "model": s.get("model") or "gpt-realtime-2.1",
        "instructions": instructions,
        "tools": [CHOOSE_CARD],
        "tool_choice": "auto",
        "audio": {
            "input": {
                "noise_reduction": {"type": s.get("mic") or "near_field"},
                "transcription": {"model": "gpt-4o-transcribe", "language": "en"},   # (English only: no guessing other scripts on noise;
                                                                                  #  the full model: the mini misheard short answers)
                # It never answers by itself: the game asks for each answer (and lets it answer the player).
                # It doesn't stop talking when someone in the room makes a sound either.
                "turn_detection": {"type": "semantic_vad", "eagerness": s.get("listen_eagerness") or "low",
                                   "create_response": False, "interrupt_response": False},
            },
            "output": {"voice": s.get("voice") or "cedar", "speed": float(s.get("speed") or 1.0)},
        },
    }
    effort = str(s.get("reasoning") or "off")
    if effort != "off":
        out["reasoning"] = {"effort": effort}
    return out


def mint(panel=None):
    """-> {token, model, voice, show_text, max_wait_s, player_can_talk, version}. Raises VoiceError.
    panel: the Voice tab's settings (the game's live "bk"), over bookkeeper.json."""
    key = read_key()
    if not key:
        raise VoiceError("no OpenAI key (openai.key or OPENAI_API_KEY)")
    try:
        s = with_panel(read_settings(), panel)
        instructions = read_instructions(s)
    except (OSError, ValueError) as e:
        raise VoiceError(f"bookkeeper.json / bookkeeper.md: {e}")
    if not s.get("on", True):
        raise VoiceError("off in bookkeeper.json")
    body = json.dumps({"session": session(s, instructions)}).encode()
    req = urllib.request.Request(API, data=body, method="POST",
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode("utf-8", "replace")
        try:
            detail = json.loads(detail)["error"]["message"]
        except (ValueError, KeyError, TypeError):
            pass
        raise VoiceError(f"OpenAI said {e.code}: {detail}")
    except Exception as e:
        raise VoiceError(f"{type(e).__name__}: {str(e)[:200]}")
    version = hashlib.sha1(instructions.encode()).hexdigest()[:8]    # which version of the personality spoke
    print(f"[voice] a life begins: {s.get('model')}, {s.get('voice')}, prompt {version}", flush=True)
    base = read_settings()                                           # (the game changes the mic and the waiting live: it needs these)
    return {"token": data.get("value"), "model": s.get("model"), "voice": s.get("voice"), "version": version,
            "speed": float(s.get("speed") or 1.0),
            "input": session(s, "")["audio"]["input"],
            "mic_default": base.get("mic") or "near_field", "listen_default": base.get("listen_eagerness") or "low",
            "show_text": bool(s.get("show_text")), "max_wait_s": float(s.get("max_wait_s") or 18),
            "player_can_talk": bool(s.get("player_can_talk", True))}


def log(entry):
    """One line of a life, said or heard, into logs/voice-YYYY-MM-DD.jsonl."""
    e = {"time": datetime.datetime.now().isoformat(timespec="seconds"),
         "life": str(entry.get("life", ""))[:40], "version": str(entry.get("version", ""))[:16],
         "who": entry.get("who") if entry.get("who") in ("bookkeeper", "player", "game") else "note",
         "text": str(entry.get("text", ""))[:4000]}
    if not e["text"].strip():
        return
    os.makedirs(LOGS, exist_ok=True)
    with open(os.path.join(LOGS, f"voice-{e['time'][:10]}.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(e, ensure_ascii=False) + "\n")
