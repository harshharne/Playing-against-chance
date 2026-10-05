#!/usr/bin/env python3
"""Local server for the Bookkeeper prototypes.

Serves the HTML files in this folder, fetches random.org numbers, and (for the
voice bench) talks to Claude with your own Anthropic API key. Keys stay in this
process and never reach the browser.

Run from the folder holding the HTML files:
    ANTHROPIC_API_KEY=sk-ant-... RANDOM_ORG_KEY=your-key python3 bookkeeper-server.py
Then open http://localhost:8000/bookkeeper-voice-bench.html

Both keys are optional:
- without ANTHROPIC_API_KEY the voice bench can't talk when run locally
- without RANDOM_ORG_KEY draws use random.org's keyless endpoint (smaller daily quota)

Endpoints:
    GET  /api/health                     -> {"chat": true/false}
    GET  /api/draw?n=40&min=1&max=6      -> {"digits": [...], "source": "random.org"}
    POST /api/chat  {turns, image, tier} -> {"text": "..."}
"""
import functools
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
RANDOM_KEY = os.environ.get("RANDOM_ORG_KEY")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY")
PORT = int(os.environ.get("PORT", "8000"))
MODELS = {
    "quick": os.environ.get("MODEL_QUICK", "claude-haiku-4-5-20251001"),
    "default": os.environ.get("MODEL_DEFAULT", "claude-sonnet-5-5"),
}


def fetch_numbers(n, lo, hi):
    if RANDOM_KEY:
        payload = json.dumps({
            "jsonrpc": "2.0", "id": 1, "method": "generateIntegers",
            "params": {"apiKey": RANDOM_KEY, "n": n, "min": lo, "max": hi, "replacement": True},
        }).encode()
        req = urllib.request.Request(
            "https://api.random.org/json-rpc/4/invoke", payload, {"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.load(r)["result"]["random"]["data"]
    url = f"https://www.random.org/integers/?num={n}&min={lo}&max={hi}&col=1&base=10&format=plain&rnd=new"
    with urllib.request.urlopen(url, timeout=10) as r:
        return [int(x) for x in r.read().decode().split()]


def chat(turns, image_b64, tier):
    # Merge consecutive same-role turns; the API needs alternating roles starting with user.
    messages = []
    for t in turns:
        role = "assistant" if t.get("role") == "assistant" else "user"
        text = str(t.get("content", ""))
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"][0]["text"] += "\n" + text
        else:
            messages.append({"role": role, "content": [{"type": "text", "text": text}]})
    if image_b64 and messages and messages[-1]["role"] == "user":
        messages[-1]["content"].insert(0, {
            "type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": image_b64},
        })
    body = json.dumps({"model": MODELS.get(tier, MODELS["quick"]), "max_tokens": 300, "messages": messages}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", body, {
        "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()


class Handler(SimpleHTTPRequestHandler):
    def _json(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/health"):
            return self._json(200, {"chat": bool(ANTHROPIC_KEY)})
        if self.path.startswith("/api/draw"):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                n = max(1, min(int(q.get("n", ["3"])[0]), 1000))
                lo, hi = int(q.get("min", ["0"])[0]), int(q.get("max", ["9"])[0])
                if not (0 <= lo <= hi <= 99):
                    raise ValueError("min and max must satisfy 0 <= min <= max <= 99")
                return self._json(200, {"digits": fetch_numbers(n, lo, hi), "source": "random.org"})
            except Exception as e:  # the page falls back if this fails
                return self._json(502, {"error": str(e)})
        super().do_GET()

    def do_POST(self):
        if not self.path.startswith("/api/chat"):
            return self._json(404, {"error": "not found"})
        if not ANTHROPIC_KEY:
            return self._json(503, {"error": "ANTHROPIC_API_KEY is not set"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(length) or b"{}")
            text = chat(req.get("turns", []), req.get("image"), req.get("tier", "quick"))
            return self._json(200, {"text": text})
        except urllib.error.HTTPError as e:
            return self._json(e.code, {"error": e.read().decode(errors="replace")[:500]})
        except Exception as e:
            return self._json(502, {"error": str(e)})


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=HERE)
    print(f"Serving {HERE} at http://localhost:{PORT}/")
    print(f"  Claude chat: {'on' if ANTHROPIC_KEY else 'off (set ANTHROPIC_API_KEY)'}")
    print(f"  random.org:  {'API key' if RANDOM_KEY else 'keyless endpoint'}")
    ThreadingHTTPServer(("127.0.0.1", PORT), handler).serve_forever()
