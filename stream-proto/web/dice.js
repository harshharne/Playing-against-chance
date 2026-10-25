// Reading ONE physical die with a camera, in the browser. No libraries.
//
// Set-up that works best: a webcam looking straight down at the throwing area, the area marked on /dice.html
// (drag a box inside your tape square), a matte floor darker than the die, even light without glare.
//
// How it reads: inside the marked area, find the biggest pale, solid, roughly square blob (the die), then count
// the dark holes inside it (the dots). "Pale" uses the weakest colour channel, so a beige wooden die stands out
// from an orange wooden table. It only reads once the die has stopped, and only reports a number after seeing it
// several frames in a row. After a report it waits for the die to move again before the next one.
//
//   const dice = createDiceReader({ video, onRoll: (n) => ..., onState: (s) => ... });
//   await dice.start(deviceId);         // a camera's deviceId ("" = the default camera)
//   dice.settings.bright = 150;         // tuning, see DEFAULTS
//   dice.draw(canvas)                   // draws what it sees (for the setup page)

export const DEFAULTS = {
  bright: 150,      // how pale a pixel must be to count as "die" (0–255). Lower it in dim light, raise it if the floor counts.
  invert: false,    // true for a DARK die with LIGHT dots
  still: 3,         // how much movement counts as "rolling": tenths of a percent of the area's pixels changing
  settle: 6,        // frames of stillness before reading (~0.4 s at 15 fps)
  agree: 3,         // the same count this many frames in a row before reporting
  roi: null,        // the throwing area, as fractions of the camera image {x, y, w, h}; null = all of it
};
const SIDE = 480;                          // the area is read at this size (its longer side): enough pixels for small dots

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("pac-dice") || "{}") }; } catch (e) { return { ...DEFAULTS }; }
}
export function saveSettings(s) { try { localStorage.setItem("pac-dice", JSON.stringify(s)); } catch (e) {} }

export function createDiceReader({ video, onRoll = () => {}, onState = () => {} }) {
  const settings = loadSettings();
  const work = document.createElement("canvas");
  const wctx = work.getContext("2d", { willReadFrequently: true });
  let W = SIDE, H = SIDE, grey, prev, label, stack, saved;
  function size(w, h) {                                 // working buffers, re-made when the area's shape changes
    if (w === W && h === H && grey) return;
    W = w; H = h; work.width = W; work.height = H;
    grey = new Uint8Array(W * H); prev = new Uint8Array(W * H);
    label = new Int32Array(W * H); stack = new Int32Array(W * H); saved = new Int32Array(W * H);
  }
  let running = false, timer = 0, stillFrames = 0, armed = true, lastCount = 0, same = 0, state = "";
  let seen = { die: null, pips: [], count: 0, moving: false };
  let maskOn = false;

  function setState(s) { if (s !== state) { state = s; onState(s); } }

  async function start(deviceId) {
    stop();
    const id = deviceId ? { deviceId: { exact: deviceId } } : {};
    try { video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { ...id, width: 1280, height: 720 }, audio: false }); }
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

  // the throwing area in camera pixels
  function area() {
    const vw = video.videoWidth, vh = video.videoHeight, r = settings.roi;
    if (!r) return { x: 0, y: 0, w: vw, h: vh };
    return { x: r.x * vw, y: r.y * vh, w: Math.max(8, r.w * vw), h: Math.max(8, r.h * vh) };
  }

  function step() {
    const a = area(), k = SIDE / Math.max(a.w, a.h);
    size(Math.max(16, Math.round(a.w * k)), Math.max(16, Math.round(a.h * k)));
    wctx.drawImage(video, a.x, a.y, a.w, a.h, 0, 0, W, H);
    const d = wctx.getImageData(0, 0, W, H).data;
    let changed = 0;
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      // pale = all three channels high (white, cream, beige wood), unlike orange wood or a dark floor
      let g = settings.invert ? 255 - Math.max(d[j], d[j + 1], d[j + 2]) : Math.min(d[j], d[j + 1], d[j + 2]);
      if (Math.abs(g - prev[i]) > 24) changed++;           // count clearly changed pixels: a small die moving still counts
      prev[i] = grey[i] = g;
    }
    const motion = changed / (W * H) * 1000;               // tenths of a percent
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

  // find the die: of the pale, solid, squarish blobs, the biggest one that has 1–6 dots in it
  function count() {
    const T = settings.bright;
    label.fill(0);
    let next = 1;
    const cands = [];
    const minDie = W * H * 0.002, maxDie = W * H * 0.4;
    for (let i = 0; i < W * H; i++) {
      if (label[i] || grey[i] < T) continue;
      const blob = flood(i, next, (k) => grey[k] >= T && !label[k]);
      next++;
      if (blob.area < minDie || blob.area > maxDie) continue;
      const bw = blob.x1 - blob.x0 + 1, bh = blob.y1 - blob.y0 + 1;
      if (Math.max(bw, bh) / Math.min(bw, bh) > 1.6) continue;          // a die is squarish, glare streaks aren't
      if (centreFill(blob) < 0.6) continue;                              // a die is solid in the middle; a tape frame is hollow
      cands.push(blob);
    }
    cands.sort((a, b) => b.area - a.area);
    seen.die = cands[0] || null; seen.pips = []; seen.count = 0;
    saved.set(label);
    for (const b of cands) {                               // the first (biggest) with a readable count wins
      label.set(saved);
      const pips = holes(b);
      if (pips.length >= 1 && pips.length <= 6) { seen.die = b; seen.pips = pips; seen.count = pips.length; break; }
    }
    return seen.count;
  }
  // how much of the middle half of a blob's box is the blob itself (dots inside count as "in")
  function centreFill(b) {
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
    const cx0 = b.x0 + (w >> 2), cx1 = b.x1 - (w >> 2), cy0 = b.y0 + (h >> 2), cy1 = b.y1 - (h >> 2);
    let n = 0, inside = 0;
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) { n++; if (label[y * W + x] === b.id || grey[y * W + x] < settings.bright * 0.6) inside++; }
    return n ? inside / n : 0;
  }
  // inside the die's box: anything not-die that can't be reached from the box's edge is a hole = a dot
  function holes(best) {
    const { x0, y0, x1, y1, id } = best;
    const OUT = -1;
    const isDie = (k) => label[k] === id;
    for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) { const k = y * W + x; if (!isDie(k) && label[k] !== OUT) floodBox(k, best, OUT); }
    for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) { const k = y * W + x; if (!isDie(k) && label[k] !== OUT) floodBox(k, best, OUT); }
    const minPip = Math.max(2, best.area * 0.004), maxPip = best.area * 0.09;
    const pips = [];
    let hole = -2;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const k = y * W + x;
      if (isDie(k) || label[k] < 0) continue;
      const h = floodHole(k, best, hole);
      hole--;
      const w = h.x1 - h.x0 + 1, hh = h.y1 - h.y0 + 1;
      if (h.area >= minPip && h.area <= maxPip && Math.max(w, hh) / Math.min(w, hh) < 2.2) pips.push(h);
    }
    return pips;
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
    return flood(start, mark, (k) => inBox(k, b) && label[k] !== b.id && label[k] >= 0 && label[k] !== mark);
  }

  // what the reader sees: the whole camera, the marked area, the die's box, the dots it counted.
  // With showMask(true), everything inside the area that counts as "die" is tinted green.
  const maskCanvas = document.createElement("canvas");
  function draw(canvas) {
    const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
    const cw = 640, ch = Math.round(640 * vh / vw);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const g = canvas.getContext("2d");
    g.fillStyle = "#222"; g.fillRect(0, 0, cw, ch);
    if (video.videoWidth) g.drawImage(video, 0, 0, cw, ch);
    if (!video.videoWidth || !grey) return;
    const a = area(), s = cw / vw;
    const ax = a.x * s, ay = a.y * s, sx = (a.w * s) / W, sy = (a.h * s) / H;   // area pixels -> canvas pixels
    if (settings.roi) {                                     // dim what's outside the area
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(0, 0, cw, ay); g.fillRect(0, ay + a.h * s, cw, ch - ay - a.h * s);
      g.fillRect(0, ay, ax, a.h * s); g.fillRect(ax + a.w * s, ay, cw - ax - a.w * s, a.h * s);
      g.strokeStyle = "#fff"; g.lineWidth = 1; g.setLineDash([5, 4]); g.strokeRect(ax, ay, a.w * s, a.h * s); g.setLineDash([]);
    }
    if (maskOn) {
      maskCanvas.width = W; maskCanvas.height = H;
      const mc = maskCanvas.getContext("2d"), img = mc.createImageData(W, H), T = settings.bright;
      for (let i = 0, j = 0; i < W * H; i++, j += 4) if (grey[i] >= T) { img.data[j + 1] = 255; img.data[j + 3] = 140; }
      mc.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = false; g.drawImage(maskCanvas, ax, ay, a.w * s, a.h * s); g.imageSmoothingEnabled = true;
    }
    if (seen.die) {
      const b = seen.die;
      g.strokeStyle = seen.moving ? "#f39c12" : "#2ecc71"; g.lineWidth = 2;
      g.strokeRect(ax + (b.x0 - 1) * sx, ay + (b.y0 - 1) * sy, (b.x1 - b.x0 + 3) * sx, (b.y1 - b.y0 + 3) * sy);
      g.fillStyle = "#e74c3c";
      seen.pips.forEach(p => { g.beginPath(); g.arc(ax + (p.x0 + p.x1 + 1) / 2 * sx, ay + (p.y0 + p.y1 + 1) / 2 * sy, Math.max(2.5, (p.x1 - p.x0 + 1) / 2 * sx), 0, 7); g.fill(); });
      g.fillStyle = "#fff"; g.font = "bold 26px system-ui"; g.fillText(String(seen.count || "?"), ax + (b.x1 + 4) * sx, ay + b.y0 * sy + 22);
    }
  }

  return { start, stop, draw, settings, showMask: (on) => { maskOn = on; }, get state() { return state; }, get seen() { return seen; } };
}
