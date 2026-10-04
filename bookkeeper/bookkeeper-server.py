#!/usr/bin/env python3
"""Serves bookkeeper-honest.html and fetches random.org digits on the server side.

Run from any folder:
    RANDOM_ORG_KEY=your-key python3 bookkeeper-server.py
Then open http://localhost:8000/bookkeeper-honest.html

Without RANDOM_ORG_KEY it uses random.org's keyless endpoint, which has a smaller daily quota.
The key stays in this process and never reaches the browser.
"""
import functools
import json
import os
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = os.environ.get("RANDOM_ORG_KEY")
PORT = int(os.environ.get("PORT", "8000"))


def fetch_digits(n):
    if KEY:
        payload = json.dumps({
            "jsonrpc": "2.0", "id": 1, "method": "generateIntegers",
            "params": {"apiKey": KEY, "n": n, "min": 0, "max": 9, "replacement": True},
        }).encode()
        req = urllib.request.Request(
            "https://api.random.org/json-rpc/4/invoke", payload, {"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.load(r)["result"]["random"]["data"]
    url = f"https://www.random.org/integers/?num={n}&min=0&max=9&col=1&base=10&format=plain&rnd=new"
    with urllib.request.urlopen(url, timeout=10) as r:
        return [int(x) for x in r.read().decode().split()]


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/draw"):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                n = max(1, min(int(q.get("n", ["3"])[0]), 1000))
                body = json.dumps({"digits": fetch_digits(n), "source": "random.org"}).encode()
                self.send_response(200)
            except Exception as e:  # the page falls back if this fails
                body = json.dumps({"error": str(e)}).encode()
                self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=HERE)
    print(f"Open http://localhost:{PORT}/bookkeeper-honest.html  (key {'set' if KEY else 'not set, using keyless endpoint'})")
    ThreadingHTTPServer(("127.0.0.1", PORT), handler).serve_forever()
