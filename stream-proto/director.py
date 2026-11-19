"""
The director: an LLM that writes what each moment of the life needs, from the life so far.

The written trajectory (trajectory.json) stays the spine: every moment already has a written scene, and the director
only ELABORATES it — the same event, with the light, the weather, the objects that carry over, the house that ages,
the clothes that follow the job. It never decides what happens (the die and random.org do) and it never invents events.
If it is slow, off, or writes something that fails the checks, the written scene is used, exactly as before.

For each moment it writes:
    world     the scene prompt for the painter (short: the painter reads 77 tokens, and the look's words and the
              place take about 30 of them, so a world is cut at 36 words)
    breathe   three small variations of that scene, for the world breathing inside the event
    clothes   what the player wears now, or "" (keeps the card's)
    line      one line for the narrative box / the Bookkeeper (used only when the panel says so)

The rules it writes by — the style bible — live in director.json, next to this file: edit them freely.
Key: ANTHROPIC_API_KEY, or anthropic.key next to this file (kept out of git; push.sh sends it).
"""
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
API = os.environ.get("DIRECTOR_API_URL", "https://api.anthropic.com/v1/messages")   # (override only for testing)
MAX_WORLD_WORDS = 36


def read_key():
    k = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if k:
        return k
    try:
        with open(os.path.join(HERE, "anthropic.key")) as f:
            return f.read().strip()
    except OSError:
        return ""


def read_bible():
    with open(os.path.join(HERE, "director.json"), encoding="utf-8") as f:
        return json.load(f)


TOOL = {
    "name": "write_moments",
    "description": "Write what each requested moment of the life needs. One entry per requested key, in the same order.",
    "input_schema": {
        "type": "object",
        "properties": {
            "moments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "description": "the moment's key, exactly as given"},
                        "world": {"type": "string", "description": "the scene prompt for the painter"},
                        "breathe": {"type": "array", "items": {"type": "string"}, "description": "the passage: 4 to 6 scenes of the life moving on after this moment, in order"},
                        "clothes": {"type": "string", "description": "what the player wears now, or empty to leave it"},
                        "line": {"type": "string", "description": "one line for the narrative box"},
                    },
                    "required": ["key", "world", "breathe", "clothes", "line"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["moments"],
        "additionalProperties": False,
    },
}
# Claude Sonnet 5.5 (and later) refuse forced tool use (tool_choice "tool"/"any" -> HTTP 400). For them the director
# asks for its answer as structured output instead: the reply is JSON that is guaranteed to match TOOL's schema.
# Thinking is set to its lowest ("between_tools") with low effort: these are short writing jobs, and every second
# counts (the game waits at most DIRECTOR WAIT for an answer). Older models keep the forced tool call.
OLD_STYLE = ("claude-sonnet-5-2", "claude-sonnet-5-0", "claude-sonnet-5-20", "claude-sonnet-4", "claude-opus-4", "claude-haiku-4", "claude-3")


def request_body(model, system, user, max_tokens, bible):
    body = {"model": model, "max_tokens": max_tokens, "system": system, "messages": [{"role": "user", "content": user}]}
    if bible.get("api") == "tool" or (bible.get("api") != "json" and model.startswith(OLD_STYLE)):
        body.update(tools=[TOOL], tool_choice={"type": "tool", "name": "write_moments"})
        return body
    body["output_config"] = {"effort": bible.get("effort", "low"), "format": {"type": "json_schema", "schema": TOOL["input_schema"]}}
    body["thinking"] = {"type": bible.get("thinking", "between_tools")}
    return body


def moments_of(data):
    """The written moments from an answer: a forced tool call (older models) or structured JSON text (newer)."""
    for block in data.get("content", []):
        if block.get("type") == "tool_use":
            return block.get("input", {}).get("moments", [])
    for block in data.get("content", []):
        if block.get("type") == "text" and block.get("text", "").strip():
            try:
                return json.loads(block["text"]).get("moments", [])
            except (ValueError, AttributeError):
                pass
    return []


def words(s):
    return len(re.findall(r"\S+", s or ""))


def clip_words(s, n):
    w = re.findall(r"\S+", s or "")
    return " ".join(w[:n]).rstrip(",;") if len(w) > n else (s or "").strip()


class Director:
    def __init__(self):
        self.key = read_key()
        self.cache = {}
        self.lock = threading.Lock()
        self.stats = {"calls": 0, "cached": 0, "failed": 0, "rejected": 0, "last_ms": None, "last_error": "", "model": ""}

    @property
    def ready(self):
        return bool(self.key)

    # ---- checks: anything that fails falls back to the written scene ----
    def check(self, m, written, bible):
        bad = [w.lower() for w in bible.get("never_in_pictures", [])]
        world = clip_words(m.get("world", ""), MAX_WORLD_WORDS)
        if not world or any(re.search(r"\b" + re.escape(b) + r"\b", world.lower()) for b in bad):
            return None
        br = [clip_words(b, MAX_WORLD_WORDS) for b in (m.get("breathe") or []) if isinstance(b, str) and b.strip()]
        br = [b for b in br if not any(re.search(r"\b" + re.escape(x) + r"\b", b.lower()) for x in bad)][:6] or [world]
        return {"world": world, "breathe": br, "clothes": clip_words(m.get("clothes", ""), 14),
                "line": clip_words(m.get("line", ""), int(bible.get("line_words", 28))), "written": written}

    def prompt(self, life, event, moments, bible):
        ledger = "\n".join(f"- age {int(a)}: {t} — {w}" + (f" ({n})" if n else "") for a, t, w, n in life.get("ledger", [])) or "- (nothing yet: the life is starting)"
        planted = "\n".join(f"- at {p['age']}: {p['text']}" for p in life.get("planted", [])) or "- none"
        who = ", ".join(x for x in [life.get("gender") or "", f"age {int(life.get('age', 0))}", life.get("place") or "",
                                    f"wears {life['wear']}" if life.get("wear") else "", ", ".join(life.get("traits", []))] if x)
        if life.get("means"):                                    # what the family had (Whom): it shows in the worlds of youth
            who += f"\nBorn into: {life['means']}"
        if life.get("light"):                                    # the light of this age (a life as one day)
            who += f"\nThe light at this age: {life['light']}"
        ms = "\n".join(
            f'- key "{m["key"]}": {m.get("what", "")}\n  written scene: {m.get("scene", "")}' + (f'\n  card says: {m["reveals"]}' if m.get("reveals") else "")
            for m in moments)
        return (f"THE LIFE SO FAR\n{ledger}\n\nSMALL THINGS PLANTED (flukes; they may show quietly in later pictures)\n{planted}\n\n"
                f"THE PLAYER NOW\n{who}\n\nTHIS EVENT\n{event.get('title', '')} ({event.get('type', '')}): {event.get('setup', '')}\n"
                + (f"The passage covers the years from age {int(event['age'])} until age {int(event['until'])}.\n" if event.get('until') is not None and event.get('age') is not None else "")
                + (f"The author's passage for these years (sharpen it, keep it this life's): {' | '.join(event['passage'])}\n" if event.get('passage') else "")
                + "\n"
                f"WRITE THESE MOMENTS (one entry each, same keys)\n{ms}")

    def write(self, life, event, moments):
        """-> {key: {world, breathe, clothes, line, written}} for the moments it could write well; {} if it couldn't."""
        if not self.key or not moments:
            return {}
        bible = read_bible()
        model = bible.get("model", "claude-sonnet-5-5")
        user = self.prompt(life, event, moments, bible)
        system = "\n".join(bible.get("system", [])) if isinstance(bible.get("system"), list) else bible.get("system", "")
        h = hashlib.sha1(json.dumps([model, system, user], sort_keys=True).encode()).hexdigest()
        with self.lock:
            if h in self.cache:
                self.stats["cached"] += 1
                return self.cache[h]
        body = request_body(model, system, user, 1500 + 700 * len(moments), bible)
        t0 = time.perf_counter()
        data, err = None, ""
        for attempt in range(2):
            try:
                req = urllib.request.Request(API, data=json.dumps(body).encode(), method="POST", headers={
                    "x-api-key": self.key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
                with urllib.request.urlopen(req, timeout=float(bible.get("timeout_s", 30))) as r:
                    data = json.loads(r.read())
                break
            except urllib.error.HTTPError as e:
                err = f"HTTP {e.code}: {e.read()[:200].decode('utf-8', 'replace')}"
                if e.code not in (429, 500, 529):
                    break
                time.sleep(1.5)
            except Exception as e:
                err = f"{type(e).__name__}: {str(e)[:200]}"
                time.sleep(0.5)
        ms = (time.perf_counter() - t0) * 1000
        self.stats.update(calls=self.stats["calls"] + 1, last_ms=round(ms), model=model)
        if data is None:
            self.stats["failed"] += 1
            self.stats["last_error"] = err
            print(f"[director] failed after {ms / 1000:.1f} s: {err}", flush=True)
            return {}
        got = {m.get("key"): m for m in moments_of(data) if isinstance(m, dict)}
        if not got:                                              # refused, cut off by max_tokens, or empty
            self.stats["failed"] += 1
            self.stats["last_error"] = f"no moments in the answer (stop_reason {data.get('stop_reason')})"
            print(f"[director] {self.stats['last_error']} after {ms / 1000:.1f} s", flush=True)
            return {}
        out = {}
        for m in moments:
            c = self.check(got.get(m["key"], {}), m.get("scene", ""), bible)
            if c:
                out[m["key"]] = c
            else:
                self.stats["rejected"] += 1
        self.stats["last_error"] = ""
        self.stats["last"] = {"event": event.get("title", ""), "moments": {k: {"world": v["world"], "passage": v["breathe"], "clothes": v["clothes"], "line": v["line"]}
                                                                         for k, v in list(out.items())[:4]}}
        print(f"[director] {event.get('title', '')}: {len(out)}/{len(moments)} moments in {ms / 1000:.1f} s ({model})", flush=True)
        for k, v in out.items():
            print(f"  {k}: {v['world'][:110]}", flush=True)
        with self.lock:
            if len(self.cache) > 256:
                self.cache.clear()
            self.cache[h] = out
        return out
