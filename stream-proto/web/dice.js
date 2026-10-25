// Reading ONE physical die with a camera, in the browser. No libraries.
//
// Set-up that works best: a webcam looking straight down into a tray with a dark, matte floor,
// a white die with black dots, even light (no hard shadows, no glare).
//
// How it reads: find the biggest bright blob (the die), then count the dark holes inside it (the dots).
// It only reads once the die has stopped moving, and only reports a number after seeing it
// several frames in a row. After a report it waits for the die to move again before the next one.
//
//   const dice = createDiceReader({ video, onRoll: (n) => ..., onState: (s) => ... });
//   await dice.start(deviceId);         // a camera's deviceId ("" = the default camera)
//   dice.settings.bright = 150;         // tuning, see DEFAULTS
//   dice.draw(canvas)                   // draws what it sees (for the test page)

export const DEFAULTS = {
  bright: 150,      // grey level above which a pixel counts as "die" (0–255). Lower it in dim light.
  invert: false,    // true for a DARK die with LIGHT dots
  still: 3,         // how little movement counts as "settled" (average grey change per pixel)
  settle: 6,        // frames of stillness before reading (~0.4 s at 15 fps)
  agree: 3,         // the same count this many frames in a row before reporting
};
const W = 320, H = 240;                   // working size

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("pac-dice") || "{}") }; } catch (e) { return { ...DEFAULTS }; }
}
export function saveSettings(s) { try { localStorage.setItem("pac-dice", JSON.stringify(s)); } catch (e) {} }

export function createDiceReader({ video, onRoll = () => {}, onState = () => {} }) {
  const settings = loadSettings();
  const work = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const wctx = work.getContext("2d", { willReadFrequently: true });
  const grey = new Uint8Array(W * H), prev = new Uint8Array(W * H);
  const label = new Int32Array(W * H), stack = new Int32Array(W * H);
  let running = false, timer = 0, stillFrames = 0, armed = true, lastCount = 0, same = 0, state = "";
  let seen = { die: null, pips: [], count: 0, moving: false };

  function setState(s) { if (s !== state) { state = s; onState(s); } }

  async function start(deviceId) {
    stop();
    const id = deviceId ? { deviceId: { exact: deviceId } } : {};
    try { video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { ...id, width: 640, height: 480 }, audio: false }); }
    catch (e) {                                           // a camera that's already open at another size can refuse; take it as it is
      if (e.name !== "OverconstrainedError" && e.name !== "NotReadableError") throw e;
      video.srcObject = await navigator.mediaDevices.getUserMedia({ video: deviceId ? id : true, audio: false });
    }
    video.muted = true; video.playsInline = true;
    await video.play();
    running = true; armed = true; stillFrames = 0; same = 0;
    setState("waiting");
    tick();
  }
  function stop() {
    running = false; clearTimeout(timer);
    if (video.srcObject) { video.srcObject.getTracks().forEach(t => t.stop()); video.srcObject = null; }
    setState("off");
  }

  function tick() {
    if (!running) return;
    if (video.videoWidth) step();
    timer = setTimeout(tick, 66);                         // ~15 readings a second is plenty
  }

  function step() {
    wctx.drawImage(video, 0, 0, W, H);
    const d = wctx.getImageData(0, 0, W, H).data;
    let motion = 0;
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      let g = (d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11) | 0;
      if (settings.invert) g = 255 - g;
      motion += Math.abs(g - prev[i]);
      prev[i] = grey[i] = g;
    }
    motion /= W * H;
    const moving = motion > settings.still;
    seen.moving = moving;

    if (moving) {                                          // in the air / rolling: get ready for the next read
      stillFrames = 0; same = 0;
      if (!armed && motion > settings.still * 2) armed = true;
      if (armed) setState("rolling");
      return;
    }
    stillFrames++;
    const n = count();
    if (!armed) { setState("shown"); return; }             // already reported this throw
    if (stillFrames < settings.settle) { setState("settling"); return; }
    if (n >= 1 && n <= 6) {
      same = n === lastCount ? same + 1 : 1;
      lastCount = n;
      setState("reading");
      if (same >= settings.agree) { armed = false; same = 0; setState("shown"); onRoll(n); }
    } else { same = 0; setState(seen.die ? "unclear" : "waiting"); }
  }

  // find the die (largest bright blob), then count the holes in it (the dots)
  function count() {
    const T = settings.bright;
    label.fill(0);
    let best = null, next = 1;
    const minDie = W * H * 0.004, maxDie = W * H * 0.45;
    for (let i = 0; i < W * H; i++) {
      if (label[i] || grey[i] < T) continue;
      const blob = flood(i, next, (k) => grey[k] >= T && !label[k]);
      if (blob.area >= minDie && blob.area <= maxDie && (!best || blob.area > best.area)) best = blob;
      next++;
    }
    seen.die = best; seen.pips = []; seen.count = 0;
    if (!best) return 0;
    // inside the die's box: anything not-die that can't be reached from the box's edge is a hole = a dot
    const { x0, y0, x1, y1, id } = best;
    const OUT = -1;
    const isDie = (k) => label[k] === id;
    for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) { const k = y * W + x; if (!isDie(k) && label[k] !== OUT) floodBox(k, best, OUT); }
    for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) { const k = y * W + x; if (!isDie(k) && label[k] !== OUT) floodBox(k, best, OUT); }
    const minPip = best.area * 0.004, maxPip = best.area * 0.09;
    let hole = -2;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const k = y * W + x;
      if (isDie(k) || label[k] < 0) continue;
      const h = floodHole(k, best, hole);
      hole--;
      const w = h.x1 - h.x0 + 1, hh = h.y1 - h.y0 + 1;
      if (h.area >= minPip && h.area <= maxPip && Math.max(w, hh) / Math.min(w, hh) < 2.2) seen.pips.push(h);
    }
    seen.count = seen.pips.length;
    return seen.count;
  }

  function flood(start, id, ok) {
    let sp = 0, area = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    stack[sp++] = start; label[start] = id;
    while (sp) {
      const k = stack[--sp], x = k % W, y = (k / W) | 0;
      area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && ok(k - 1)) { label[k - 1] = id; stack[sp++] = k - 1; }
      if (x < W - 1 && ok(k + 1)) { label[k + 1] = id; stack[sp++] = k + 1; }
      if (y > 0 && ok(k - W)) { label[k - W] = id; stack[sp++] = k - W; }
      if (y < H - 1 && ok(k + W)) { label[k + W] = id; stack[sp++] = k + W; }
    }
    return { id, area, x0, y0, x1, y1 };
  }
  const inBox = (k, b) => { const x = k % W, y = (k / W) | 0; return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1; };
  function floodBox(start, b, mark) { return flood(start, mark, (k) => inBox(k, b) && label[k] !== b.id && label[k] !== mark); }
  function floodHole(start, b, mark) {
    const h = flood(start, mark, (k) => inBox(k, b) && label[k] !== b.id && label[k] >= 0 && label[k] !== mark);
    return h;
  }

  // what the reader sees: the camera, the die's box, the dots it counted
  function draw(canvas) {
    const g = canvas.getContext("2d");
    canvas.width = W; canvas.height = H;
    if (video.videoWidth) g.drawImage(video, 0, 0, W, H);
    if (seen.die) {
      const b = seen.die;
      g.strokeStyle = seen.moving ? "#f39c12" : "#2ecc71"; g.lineWidth = 2;
      g.strokeRect(b.x0 - 1, b.y0 - 1, b.x1 - b.x0 + 3, b.y1 - b.y0 + 3);
      g.fillStyle = "#e74c3c";
      seen.pips.forEach(p => { g.beginPath(); g.arc((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, Math.max(2, (p.x1 - p.x0) / 2 + 1), 0, 7); g.fill(); });
      g.fillStyle = "#fff"; g.font = "bold 22px system-ui"; g.fillText(String(seen.count || "?"), b.x1 + 6, b.y0 + 18);
    }
  }

  return { start, stop, draw, settings, get state() { return state; }, get seen() { return seen; } };
}
