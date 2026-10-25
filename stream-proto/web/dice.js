// Reading ONE physical die with a camera, in the browser. No AI, no GPU, no libraries.
//
// The trick: a photo of the EMPTY throwing area is taken once ("empty tray"). After a throw, whatever differs
// from that photo is the die (the table's wood, stains, tape and glare are in both, so they cancel out).
// Inside the die, the top face is its brightest part (lit from above; the side faces are darker), and the dots are
// the holes in that face. Dots on the side faces and the die's shadow aren't surrounded by the top face, so they don't count.
// It only reads once the die has stopped, and only reports a number after seeing it several frames in a row.
//
//   const dice = createDiceReader({ video, onRoll: (n) => ..., onState: (s) => ... });
//   await dice.start(deviceId);
//   dice.captureEmpty()                 // with the die OUT of the area: remember what empty looks like
//   dice.draw(canvas)                   // what it sees (for the setup page)

export const DEFAULTS = {
  sens: 20,         // how different from the empty tray a pixel must be to count as "die" (colour difference, 0–255)
  face: 0.8,        // the top face = die pixels at least this bright, as a share of the die's brightest (side faces are darker)
  invert: false,    // true for a DARK die with LIGHT dots
  still: 3,         // movement that counts as "rolling": tenths of a percent of the area's pixels changing
  settle: 5,        // still frames before reading (~0.35 s)
  agree: 3,         // the same count this many frames in a row before reporting
  roi: null,        // the throwing area, fractions of the camera image {x, y, w, h}; null = all of it
};
const SIDE = 480;                          // the area is read at this size (its longer side)
const REF_KEY = "pac-dice-empty";

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("pac-dice") || "{}") }; } catch (e) { return { ...DEFAULTS }; }
}
export function saveSettings(s) { try { localStorage.setItem("pac-dice", JSON.stringify(s)); } catch (e) {} }
const roiKey = (r) => r ? [r.x, r.y, r.w, r.h].map(v => v.toFixed(4)).join(",") : "all";

export function createDiceReader({ video, onRoll = () => {}, onState = () => {} }) {
  const settings = loadSettings();
  const work = document.createElement("canvas");
  const wctx = work.getContext("2d", { willReadFrequently: true });
  let W = 0, H = 0, N = 0;
  let rgb, lum, prev, fg, tmp, label, mark, stack;
  let ref = null, refFor = "";                            // the empty tray (RGB floats) and the area it was taken for
  let capturing = 0, capSum = null;
  function size(w, h) {
    if (w === W && h === H) return;
    W = w; H = h; N = W * H; work.width = W; work.height = H;
    rgb = new Uint8ClampedArray(N * 3); lum = new Uint8Array(N); prev = new Uint8Array(N);
    fg = new Uint8Array(N); tmp = new Uint8Array(N);
    label = new Int32Array(N); mark = new Int32Array(N); stack = new Int32Array(N);
  }
  let running = false, timer = 0, stillFrames = 0, armed = true, lastCount = 0, same = 0, state = "";
  let seen = { die: null, face: null, pips: [], count: 0, moving: false };
  let maskOn = false;
  const setState = (s) => { if (s !== state) { state = s; onState(s); } };

  // ---------- camera ----------
  async function start(deviceId) {
    stop();
    const id = deviceId ? { deviceId: { exact: deviceId } } : {};
    try { video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { ...id, width: 1280, height: 720 }, audio: false }); }
    catch (e) {
      if (e.name !== "OverconstrainedError" && e.name !== "NotReadableError") throw e;
      video.srcObject = await navigator.mediaDevices.getUserMedia({ video: deviceId ? id : true, audio: false });
    }
    video.muted = true; video.playsInline = true;
    await video.play();
    // the camera changing its own exposure would make the empty tray look different: lock it once it has settled, if the camera allows
    setTimeout(() => {
      const tr = video.srcObject && video.srcObject.getVideoTracks()[0];
      const caps = tr && tr.getCapabilities ? tr.getCapabilities() : {};
      const adv = [];
      if ((caps.exposureMode || []).includes("manual")) adv.push({ exposureMode: "manual" });
      if ((caps.whiteBalanceMode || []).includes("manual")) adv.push({ whiteBalanceMode: "manual" });
      if ((caps.focusMode || []).includes("manual")) adv.push({ focusMode: "manual" });
      if (adv.length) tr.applyConstraints({ advanced: adv }).catch(() => {});
    }, 2500);
    running = true; armed = true; stillFrames = 0; same = 0;
    loadEmpty();
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
    timer = setTimeout(tick, 66);
  }
  function area() {
    const vw = video.videoWidth, vh = video.videoHeight, r = settings.roi;
    if (!r) return { x: 0, y: 0, w: vw, h: vh };
    return { x: r.x * vw, y: r.y * vh, w: Math.max(8, r.w * vw), h: Math.max(8, r.h * vh) };
  }

  // ---------- the empty tray ----------
  function captureEmpty() { capturing = 10; capSum = null; }  // average the next 10 frames
  function finishCapture() {
    ref = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) ref[i] = capSum[i] / 10;
    refFor = roiKey(settings.roi) + "|" + W + "x" + H;
    try {                                                   // keep it for the game, as a small picture
      const c = Object.assign(document.createElement("canvas"), { width: W, height: H });
      const g = c.getContext("2d"), img = g.createImageData(W, H);
      for (let i = 0; i < N; i++) { img.data[i * 4] = ref[i * 3]; img.data[i * 4 + 1] = ref[i * 3 + 1]; img.data[i * 4 + 2] = ref[i * 3 + 2]; img.data[i * 4 + 3] = 255; }
      g.putImageData(img, 0, 0);
      localStorage.setItem(REF_KEY, JSON.stringify({ for: refFor, png: c.toDataURL("image/png") }));
      saveSettings(settings);                               // the area belongs with its empty picture
    } catch (e) {}
    armed = true; same = 0;
  }
  function loadEmpty() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(REF_KEY) || "null"); } catch (e) {}
    if (!saved) return;
    const img = new Image();
    img.onload = () => {
      const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
      const g = c.getContext("2d"); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      const r = new Float32Array(img.width * img.height * 3);
      for (let i = 0, n = img.width * img.height; i < n; i++) { r[i * 3] = d[i * 4]; r[i * 3 + 1] = d[i * 4 + 1]; r[i * 3 + 2] = d[i * 4 + 2]; }
      ref = r; refFor = saved.for;
    };
    img.src = saved.png;
  }
  const haveEmpty = () => !!ref && refFor === roiKey(settings.roi) + "|" + W + "x" + H && ref.length === N * 3;

  // ---------- every frame ----------
  function step() {
    const a = area(), k = SIDE / Math.max(a.w, a.h);
    size(Math.max(16, Math.round(a.w * k)), Math.max(16, Math.round(a.h * k)));
    wctx.drawImage(video, a.x, a.y, a.w, a.h, 0, 0, W, H);
    const d = wctx.getImageData(0, 0, W, H).data;
    let changed = 0;
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      rgb[i * 3] = d[j]; rgb[i * 3 + 1] = d[j + 1]; rgb[i * 3 + 2] = d[j + 2];
      let l = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
      if (settings.invert) l = 255 - l;
      if (Math.abs(l - prev[i]) > 24) changed++;
      prev[i] = lum[i] = l;
    }
    if (capturing > 0) {
      if (!capSum || capSum.length !== N * 3) capSum = new Float32Array(N * 3);
      for (let i = 0; i < N * 3; i++) capSum[i] += rgb[i];
      if (--capturing === 0) finishCapture();
      setState("learning empty tray");
      return;
    }
    const moving = changed / N * 1000 > settings.still;
    seen.moving = moving;
    if (moving) {
      stillFrames = 0; same = 0;
      if (!armed && changed / N * 1000 > settings.still * 2) armed = true;
      if (armed) setState("rolling");
      return;
    }
    stillFrames++;
    if (!haveEmpty()) { seen.die = null; seen.face = null; setState("needs empty tray"); return; }
    const n = count();
    if (!armed) { setState("shown"); return; }
    if (stillFrames < settings.settle) { setState("settling"); return; }
    if (n >= 1 && n <= 6) {
      same = n === lastCount ? same + 1 : 1;
      lastCount = n;
      setState("reading");
      if (same >= settings.agree) { armed = false; same = 0; setState("shown"); onRoll(n); }
    } else { same = 0; setState(seen.die ? "unclear" : "waiting"); }
  }

  // ---------- finding the die and its dots ----------
  function count() {
    seen.die = null; seen.face = null; seen.pips = []; seen.count = 0;
    // 1. what differs from the empty tray (after evening out any overall change in light)
    const gain = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      let a = 0, b = 0;
      for (let i = c; i < N * 3; i += 3 * 7) { a += rgb[i]; b += ref[i]; }
      gain[c] = b > 0 ? a / b : 1;
    }
    const T = settings.sens * 3;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const diff = Math.abs(rgb[o] - ref[o] * gain[0]) + Math.abs(rgb[o + 1] - ref[o + 1] * gain[1]) + Math.abs(rgb[o + 2] - ref[o + 2] * gain[2]);
      fg[i] = diff > T ? 1 : 0;
    }
    const r = Math.max(1, Math.round(W / 240));             // close small gaps, drop specks
    morph(fg, r, true); morph(fg, r, false);                // close
    morph(fg, r, false); morph(fg, r, true);                // open
    // 2. the die = the biggest changed blob of a sensible size
    label.fill(0);
    let die = null, id = 1;
    for (let i = 0; i < N; i++) {
      if (!fg[i] || label[i]) continue;
      const b = flood(label, i, id, (k) => fg[k] && !label[k]);
      id++;
      if (b.area < N * 0.001 || b.area > N * 0.3) continue;
      if (!die || b.area > die.area) die = b;
    }
    if (!die) return 0;
    seen.die = die;
    // 3. the top face = the brightest part of the die (the 85th-percentile brightness inside the blob sets the scale)
    const hist = new Uint32Array(256);
    for (let y = die.y0; y <= die.y1; y++) for (let x = die.x0; x <= die.x1; x++) { const k = y * W + x; if (label[k] === die.id) hist[lum[k]]++; }
    let acc = 0, top = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= die.area * 0.85) { top = v; break; } }
    const darkT = top * settings.face;
    mark.fill(0);
    let face = null, fid = 1;
    for (let y = die.y0; y <= die.y1; y++) for (let x = die.x0; x <= die.x1; x++) {
      const k = y * W + x;
      if (mark[k] || label[k] !== die.id || lum[k] < darkT) continue;
      const b = flood(mark, k, fid, (q) => !mark[q] && label[q] === die.id && lum[q] >= darkT);
      fid++;
      if (!face || b.area > face.area) face = b;
    }
    if (!face || face.area < 30) return 0;
    seen.face = face;
    // 4. the dots = holes in the face: dark patches the face surrounds completely (a shadow touches the edge, so it isn't one)
    const OUT = -1, inF = (q) => mark[q] === face.id;
    const inBox = (q) => { const x = q % W, y = (q / W) | 0; return x >= face.x0 && x <= face.x1 && y >= face.y0 && y <= face.y1; };
    const edge = (q) => { if (!inF(q) && mark[q] !== OUT) flood(mark, q, OUT, (p) => inBox(p) && !inF(p) && mark[p] !== OUT); };
    for (let x = face.x0; x <= face.x1; x++) { edge(face.y0 * W + x); edge(face.y1 * W + x); }
    for (let y = face.y0; y <= face.y1; y++) { edge(y * W + face.x0); edge(y * W + face.x1); }
    const holes = [];
    let hid = -2;
    for (let y = face.y0; y <= face.y1; y++) for (let x = face.x0; x <= face.x1; x++) {
      const q = y * W + x;
      if (inF(q) || mark[q] === OUT || mark[q] <= -2) continue;
      const h = flood(mark, q, hid, (p) => inBox(p) && !inF(p) && mark[p] !== OUT && mark[p] > -2);
      hid--;
      const w = h.x1 - h.x0 + 1, hh = h.y1 - h.y0 + 1;
      if (h.area < Math.max(3, face.area * 0.004) || h.area > face.area * 0.12) continue;   // specks / not a dot
      if (Math.max(w, hh) / Math.min(w, hh) > 1.8) continue;                                 // dots are round, not slivers
      if (h.area / (w * hh) < 0.45) continue;                                                // ...and fill their box
      holes.push(h);
    }
    // 5. the dots on one face are all about the same size
    if (holes.length > 1) {
      const sizes = holes.map(h => h.area).sort((a, b) => a - b), m = sizes[Math.floor(sizes.length / 2)];
      seen.pips = holes.filter(h => h.area > m * 0.4 && h.area < m * 2.5);
    } else seen.pips = holes;
    seen.count = seen.pips.length;
    return seen.count;
  }

  // grow (on=true) or shrink (on=false) a 0/1 mask by r pixels, square neighbourhood, two passes
  function morph(m, r, on) {
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        let v = on ? 0 : 1;
        for (let dx = -r; dx <= r; dx++) { const xx = x + dx; const s = xx < 0 || xx >= W ? (on ? 0 : 1) : m[row + xx]; if (on ? s : !s) { v = on ? 1 : 0; break; } }
        tmp[row + x] = v;
      }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        let v = on ? 0 : 1;
        for (let dy = -r; dy <= r; dy++) { const yy = y + dy; const s = yy < 0 || yy >= H ? (on ? 0 : 1) : tmp[yy * W + x]; if (on ? s : !s) { v = on ? 1 : 0; break; } }
        m[y * W + x] = v;
      }
    }
  }
  function flood(lab, start, id, ok) {
    let sp = 0, area = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    stack[sp++] = start; lab[start] = id;
    while (sp) {
      const k = stack[--sp], x = k % W, y = (k / W) | 0;
      area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && ok(k - 1)) { lab[k - 1] = id; stack[sp++] = k - 1; }
      if (x < W - 1 && ok(k + 1)) { lab[k + 1] = id; stack[sp++] = k + 1; }
      if (y > 0 && ok(k - W)) { lab[k - W] = id; stack[sp++] = k - W; }
      if (y < H - 1 && ok(k + W)) { lab[k + W] = id; stack[sp++] = k + W; }
    }
    return { id, area, x0, y0, x1, y1 };
  }

  // ---------- what it sees (setup page) ----------
  const maskCanvas = document.createElement("canvas");
  function draw(canvas) {
    const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
    const cw = 640, ch = Math.round(640 * vh / vw);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const g = canvas.getContext("2d");
    g.fillStyle = "#222"; g.fillRect(0, 0, cw, ch);
    if (video.videoWidth) g.drawImage(video, 0, 0, cw, ch);
    if (!video.videoWidth || !W) return;
    const a = area(), s = cw / vw;
    const ax = a.x * s, ay = a.y * s, aw = a.w * s, ah = a.h * s, sx = aw / W, sy = ah / H;
    if (settings.roi) {
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(0, 0, cw, ay); g.fillRect(0, ay + ah, cw, ch - ay - ah); g.fillRect(0, ay, ax, ah); g.fillRect(ax + aw, ay, cw - ax - aw, ah);
      g.strokeStyle = "#fff"; g.lineWidth = 1; g.setLineDash([5, 4]); g.strokeRect(ax, ay, aw, ah); g.setLineDash([]);
    }
    if (maskOn && haveEmpty() && !seen.moving) {          // green = differs from the empty tray
      maskCanvas.width = W; maskCanvas.height = H;
      const mc = maskCanvas.getContext("2d"), img = mc.createImageData(W, H);
      for (let i = 0; i < N; i++) if (fg[i]) { img.data[i * 4 + 1] = 255; img.data[i * 4 + 3] = 110; }
      mc.putImageData(img, 0, 0);
      g.drawImage(maskCanvas, ax, ay, aw, ah);
    }
    const box = (b, col, wd) => { g.strokeStyle = col; g.lineWidth = wd; g.strokeRect(ax + (b.x0 - 1) * sx, ay + (b.y0 - 1) * sy, (b.x1 - b.x0 + 3) * sx, (b.y1 - b.y0 + 3) * sy); };
    if (seen.die) box(seen.die, seen.moving ? "#f39c12" : "rgba(46,204,113,0.6)", 1);
    if (seen.face) {
      box(seen.face, "#2ecc71", 2);
      g.fillStyle = "#e74c3c";
      seen.pips.forEach(p => { g.beginPath(); g.arc(ax + (p.x0 + p.x1 + 1) / 2 * sx, ay + (p.y0 + p.y1 + 1) / 2 * sy, Math.max(3, (p.x1 - p.x0 + 1) / 2 * sx), 0, 7); g.fill(); });
      g.fillStyle = "#fff"; g.font = "bold 26px system-ui"; g.fillText(String(seen.count || "?"), ax + (seen.face.x1 + 4) * sx, ay + seen.face.y0 * sy + 22);
    }
  }

  return {
    start, stop, draw, settings, captureEmpty,
    showMask: (on) => { maskOn = on; },
    get hasEmpty() { return haveEmpty(); },
    get state() { return state; }, get seen() { return seen; },
  };
}
