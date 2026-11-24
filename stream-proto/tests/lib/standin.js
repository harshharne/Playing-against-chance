// The stand-in: the real server in MOCK mode (no GPU, no keys), run from a temporary copy of stream-proto so a test
// never touches your files (game_live.json, tuned.json, logs) and on its own port so it never meets the tunnel (8766).
//   const s = await standin({ life: "short", slow: 1 })   ->  { url, dir, stop(), kill(), restart() }
//   life: "full" = trajectory.json · "short" = a few events (tests/lib/short_life.py makes it)
//   slow: MOCK_SLOW (act like a slower GPU)
const { spawn, execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const SRC = path.resolve(__dirname, "..", "..");
const PY = process.env.PYTHON || "python3";
const SKIP = new Set(["tests", "logs", "__pycache__", "game_live.json", "tuned.json", ".version", "throws", "node_modules"]);

async function standin({ port = 18700 + Math.floor(Math.random() * 200), life = "full", slow = 1, env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pac-standin-"));
  fs.cpSync(SRC, dir, { recursive: true, filter: (p) => !SKIP.has(path.basename(p)) && !/\.(key|safetensors|bin)$/.test(p) });
  let traj = path.join(dir, "trajectory.json");
  if (life === "short") {
    traj = path.join(dir, "short_life.json");
    execFileSync(PY, [path.join(__dirname, "short_life.py"), path.join(dir, "trajectory.json"), traj]);
  }
  const url = `http://127.0.0.1:${port}`;
  let proc = null;
  const logFile = path.join(dir, "server.log");
  function launch() {
    const out = fs.openSync(logFile, "a");
    proc = spawn(PY, ["stream_server.py"], { cwd: dir, stdio: ["ignore", out, out],
      env: { ...process.env, MOCK: "1", PORT: String(port), MOCK_SLOW: String(slow), TRAJECTORY: traj, ...env } });
  }
  async function ready(ms = 45000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { const r = await fetch(url + "/health"); if (r.ok) return true; } catch (e) {}
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error("the stand-in didn't start: see " + logFile);
  }
  launch(); await ready();
  return {
    url, dir, log: logFile,
    async restart() { launch(); await ready(); },
    kill() { if (proc) { proc.kill("SIGKILL"); proc = null; } },          // as if the machine died
    stop() { if (proc) { proc.kill("SIGTERM"); proc = null; } try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} },
  };
}

// a browser for the game: camera and mic faked, sound allowed, WebGL in software
async function browser() {
  const { chromium } = require("playwright");
  return chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist",
    "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
}

// errors worth failing on (not: the sandbox's missing internet for MediaPipe / fonts, the voice with no key)
function watchErrors(page) {
  const errs = [];
  page.on("pageerror", e => errs.push("PAGEERROR " + (e.stack || e.message).slice(0, 2500)));
  page.on("console", m => {
    const t = m.text();
    if (m.type() !== "error" && !/\[(worldclock|bodywarp|live)\]/.test(t)) return;
    if (/ERR_(CONNECTION|TUNNEL|NAME|INTERNET|PROXY|CERT)|Failed to fetch|net::|mediapipe|storage\.googleapis|jsdelivr|segmentation unavailable|pose unavailable|voice|404|503/i.test(t)) return;
    errs.push(t.slice(0, 500));
  });
  return errs;
}

// play the game like a visitor: pick a card when asked, throw when it waits for the die. Stops when until() says so.
async function play(page, url, { secs = 300, until = () => false, every = null, pick = null } = {}) {
  const t0 = Date.now(), log = [];
  let last = "";
  while (Date.now() - t0 < secs * 1000) {
    let s = {};
    try { s = (await (await fetch(url + "/game/state")).json()).state || {}; } catch (e) {}
    if (s.turn === "pick") await page.keyboard.press(String(pick ? pick(s) : 1 + Math.floor(Math.random() * 3))).catch(() => {});
    if (s.turn === "throw" || s.turn === "begin" || s.screen === "off")
      await fetch(url + "/game/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cmd: "roll" }) }).catch(() => {});
    if (s.event && s.event !== last) { last = s.event; log.push(`${((Date.now() - t0) / 1000).toFixed(0)}s ${s.event}`); }
    if (every) await every(s, (Date.now() - t0) / 1000);
    if (until(s, (Date.now() - t0) / 1000)) break;
    await page.waitForTimeout(400);
  }
  return log;
}

const post = (url, p, body) => fetch(url + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// is the screen showing something (not one flat colour)?
const notBlank = (page) => page.evaluate(() => {
  const c = document.getElementById("out"), x = c && c.getContext("2d");
  if (!x || !c.width) return null;
  const d = x.getImageData(0, 0, c.width, c.height).data; let mn = 765, mx = 0;
  for (let i = 0; i < d.length; i += 4 * 997) { const v = d[i] + d[i + 1] + d[i + 2]; mn = Math.min(mn, v); mx = Math.max(mx, v); }
  return mx - mn > 6;
}).catch(() => null);

module.exports = { standin, browser, watchErrors, play, post, notBlank };
