// The live engine shared by the lab page (index.html) and the game (game.html):
// camera -> person cut-out -> generated person over a generated background, drawn into one canvas.
//
//   const live = createLive({ out, video, params });   params() -> { look }   look: "pixel" | "line" | ""  (a browser filter)
//   Everything about the painting itself (change, style, LoRAs, steadiness) is tuned on /panel and lives on the server.
//   live.setPerson("a baby girl ...")     // null = show the real you (or nothing)
//   await live.setBackground("a village") // null = your real room
//   live.setScene(fn)                     // draw your own scene instead (fn(ctx, W, H, now)); null = back to live
//   live.stat                             // fps, timings, notes for a status line

import { findCamera, builtInCamera } from "./cameras.js";

export function createLive({ out, video, params }) {
  const octx = out.getContext("2d");
  let W = 640, H = 384;
  const mk = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
  let grab, mask, personMask, fg, send, prevCut, gen;      // working canvases, sized once the server tells us W x H
  const tiny = Object.assign(document.createElement("canvas"), { width: 32, height: 20 });       // "has anything moved?"
  const poseCanvas = Object.assign(document.createElement("canvas"), { width: 64, height: 38 }); // "where is the body?"

  let online = false, fgPrompt = null, bgPrompt = null, flying = 0, seq = 0, shownSeq = 0;
  let bgImg = null, oldBg = null, bgAt = 0, person = null, personAt = 0, fade = 150, lastSig = null;
  let personPose = null, prevPose = null, livePose = null;
  let segmenter = null, segImage = null, segOk = false, camCover = 0, scene = null;
  const stat = { ms: 0, bgMs: 0, times: [], note: "", seg: "", online: false, engine: "", references: true, fps: "–" };

  function sizeCanvases() {
    out.width = W; out.height = H;
    [grab, mask, personMask, fg, send, prevCut, gen] = [mk(), mk(), mk(), mk(), mk(), mk(), mk()];
  }
  sizeCanvases();

  // ---------- camera ----------
  async function startCamera() {
    let cam = "";                                           // the avatar camera chosen on /dice.html, if any
    try { cam = (await findCamera("pac-avatar-cam")) || (await builtInCamera()); } catch (e) {}   // else the Mac's own camera
    const want = { width: 1280, height: 720 };
    try { video.srcObject = await navigator.mediaDevices.getUserMedia({ video: cam ? { ...want, deviceId: { exact: cam } } : want, audio: false }); }
    catch (e) { video.srcObject = await navigator.mediaDevices.getUserMedia({ video: want, audio: false }); }   // that camera is gone: use the default
    await video.play();
    requestAnimationFrame(render);
  }
  // the middle of the camera, cropped to the generation shape and mirrored like a mirror
  function capture() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return false;
    const g = grab.getContext("2d"), ar = W / H;
    let sw = vw, sh = vw / ar;
    if (sh > vh) { sh = vh; sw = vh * ar; }
    g.save(); g.translate(W, 0); g.scale(-1, 1);
    g.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, W, H);
    g.restore();
    return true;
  }

  // ---------- cutting the person out (MediaPipe selfie segmentation, in the browser) ----------
  async function startSegmenter() {
    try {
      const v = "0.10.14";
      const { FilesetResolver, ImageSegmenter } = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${v}/vision_bundle.mjs`);
      const files = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${v}/wasm`);
      const opts = (mode) => ({
        baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite", delegate: "GPU" },
        runningMode: mode, outputConfidenceMasks: true, outputCategoryMask: false,
      });
      segmenter = await ImageSegmenter.createFromOptions(files, opts("VIDEO"));   // you, in the camera
      segImage = await ImageSegmenter.createFromOptions(files, opts("IMAGE"));    // the person the model drew
      segOk = true;
    } catch (e) {
      console.warn("segmentation unavailable:", e);
      stat.seg = "no person cut-out (segmenter didn't load: check internet)";
    }
  }
  // MediaPipe's "how sure is this pixel a person" -> a mask canvas; returns how much of the frame is person
  function writeMask(res, canvas) {
    const conf = res.confidenceMasks && res.confidenceMasks[0];
    if (!conf) return -1;
    const f = conf.getAsFloat32Array(), m = canvas.getContext("2d");
    const data = m.createImageData(W, H), d = data.data;
    let cover = 0;
    for (let i = 0, j = 3; i < f.length; i++, j += 4) { const a = f[i] > 0.15 ? Math.min(255, f[i] * 320) : 0; d[j] = a; cover += a; }
    m.putImageData(data, 0, 0);
    return cover / (255 * f.length);
  }
  function segment() {
    const m = mask.getContext("2d");
    if (!segOk) { m.fillStyle = "#000"; m.fillRect(0, 0, W, H); return; }   // no segmenter: everything counts as "you"
    segmenter.segmentForVideo(grab, performance.now(), (res) => { const c = writeMask(res, mask); if (c >= 0) camCover = c; });
  }
  // the outline of the person the MODEL drew (hat, beard, costume and all), so nothing gets clipped.
  // If it doesn't look like a person any more, fall back to your camera outline.
  function fitMask(bmp, fallback) {
    const pm = personMask.getContext("2d");
    const useFallback = () => { pm.clearRect(0, 0, W, H); pm.drawImage(fallback, 0, 0); };
    if (!segImage) return useFallback();
    const g = gen.getContext("2d"); g.clearRect(0, 0, W, H); g.drawImage(bmp, 0, 0, W, H);
    let done = false;
    segImage.segment(gen, (res) => { const c = writeMask(res, personMask); done = c >= 0 && c > camCover * 0.3; });
    if (!done) useFallback();
  }
  // an image, keeping only the parts where the mask says "person", with soft edges
  function cutout(src, maskCanvas) {
    const g = fg.getContext("2d");
    g.globalCompositeOperation = "source-over"; g.filter = "none";
    g.clearRect(0, 0, W, H);
    g.drawImage(src, 0, 0, W, H);
    g.globalCompositeOperation = "destination-in";
    g.filter = "blur(2px)";
    g.drawImage(maskCanvas, 0, 0);
    g.filter = "none"; g.globalCompositeOperation = "source-over";
    return fg;
  }

  // ---------- the screen ----------
  function drawBackground(g) {
    if (!bgImg) { g.drawImage(grab, 0, 0); return; }         // no background: your room stays
    const k = Math.min(1, (performance.now() - bgAt) / 600);
    if (oldBg && k < 1) { g.globalAlpha = 1; g.drawImage(oldBg, 0, 0, W, H); g.globalAlpha = k; }
    g.drawImage(bgImg, 0, 0, W, H);
    g.globalAlpha = 1;
  }
  function render(now) {
    if (capture()) {
      segment();
      if (scene) scene(octx, W, H, now);                                     // a drawn scene (e.g. birth)
      else if (!fgPrompt && !bgPrompt) octx.drawImage(grab, 0, 0);           // nothing set: just you
      else {
        drawBackground(octx);
        if (fgPrompt && person) {                                            // the re-imagined you
          livePose = smoothPose(livePose, poseOf(mask));
          follow(octx, personPose, () => octx.drawImage(cutout(person, personMask), 0, 0));
          const k = Math.min(1, (performance.now() - personAt) / fade);
          if (k < 1) { octx.globalAlpha = 1 - k; follow(octx, prevPose, () => octx.drawImage(prevCut, 0, 0)); octx.globalAlpha = 1; }
        } else if (bgImg) octx.drawImage(cutout(grab, mask), 0, 0);          // the real you, on the new background
      }
      applyLook(params().look);                                              // 8-bit / line drawing, on everything
    }
    const t = stat.times;
    stat.fps = t.length > 1 ? ((t.length - 1) / ((t[t.length - 1] - t[0]) / 1000)).toFixed(1) : "–";
    stat.online = online;
    requestAnimationFrame(render);
  }

  // ---------- the look: a filter over the finished frame, so the world always looks the same ----------
  // "pixel": big blocks, each colour channel cut to a few levels, with a checkerboard dither (the classic 8-bit trick).
  // "line": ink outlines on paper. Anything else: as generated.
  const PIXEL = 4;                                            // size of one 8-bit pixel, in picture pixels
  const LEVELS = 6;                                           // per colour channel: 6 x 6 x 6 = 216 colours
  const DITHER = 0.3;                                         // 0 = flat bands, 1 = heavy checkerboard
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v / 16 - 0.47) * DITHER);
  const lookCanvas = document.createElement("canvas");
  let lastLook = null;
  function applyLook(look) {
    if (look !== lastLook) { out.style.imageRendering = look === "pixel" ? "pixelated" : "auto"; lastLook = look; }
    if (look === "pixel") pixelate(PIXEL);
    else if (look === "line") lineDrawing();
  }
  function pixelate(block) {
    const pw = Math.round(W / block), ph = Math.round(H / block);
    lookCanvas.width = pw; lookCanvas.height = ph;
    const g = lookCanvas.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingEnabled = true; g.drawImage(out, 0, 0, pw, ph);
    const img = g.getImageData(0, 0, pw, ph), d = img.data, step = 255 / (LEVELS - 1);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const o = (y * pw + x) * 4, j = BAYER[(y & 3) * 4 + (x & 3)] * step;
      for (let c = 0; c < 3; c++) d[o + c] = Math.max(0, Math.min(255, Math.round((d[o + c] + j) / step) * step));
    }
    g.putImageData(img, 0, 0);
    octx.imageSmoothingEnabled = false; octx.drawImage(lookCanvas, 0, 0, W, H); octx.imageSmoothingEnabled = true;
  }
  function lineDrawing() {
    const lw = Math.round(W / 2), lh = Math.round(H / 2);
    lookCanvas.width = lw; lookCanvas.height = lh;
    const g = lookCanvas.getContext("2d", { willReadFrequently: true });
    g.filter = "blur(1px)"; g.drawImage(out, 0, 0, lw, lh); g.filter = "none";
    const img = g.getImageData(0, 0, lw, lh), d = img.data, n = lw * lh;
    const grey = new Float32Array(n);
    for (let i = 0; i < n; i++) grey[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
    const paper = [247, 244, 236], ink = [26, 26, 26], T = 70;
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      const i = y * lw + x;
      let a = 0;
      if (x > 0 && y > 0 && x < lw - 1 && y < lh - 1) {     // edge strength (Sobel)
        const gx = grey[i - lw + 1] + 2 * grey[i + 1] + grey[i + lw + 1] - grey[i - lw - 1] - 2 * grey[i - 1] - grey[i + lw - 1];
        const gy = grey[i + lw - 1] + 2 * grey[i + lw] + grey[i + lw + 1] - grey[i - lw - 1] - 2 * grey[i - lw] - grey[i - lw + 1];
        a = Math.max(0, Math.min(1, (Math.abs(gx) + Math.abs(gy) - T) / T));
      }
      const o = i * 4;
      d[o] = paper[0] + (ink[0] - paper[0]) * a; d[o + 1] = paper[1] + (ink[1] - paper[1]) * a; d[o + 2] = paper[2] + (ink[2] - paper[2]) * a;
    }
    g.putImageData(img, 0, 0);
    octx.drawImage(lookCanvas, 0, 0, W, H);
  }

  // ---------- following you between generated frames ----------
  // A new picture only arrives a few times a second. In between, the last picture is moved and scaled
  // to wherever your body is right now (read from the live camera outline), so the motion stays fluid.
  function poseOf(maskCanvas) {
    const g = poseCanvas.getContext("2d", { willReadFrequently: true });
    g.clearRect(0, 0, 64, 38); g.drawImage(maskCanvas, 0, 0, 64, 38);
    const d = g.getImageData(0, 0, 64, 38).data;
    let sum = 0, sx = 0, sy = 0, top = 38;
    for (let y = 0; y < 38; y++) for (let x = 0; x < 64; x++) {
      const a = d[(y * 64 + x) * 4 + 3] / 255;
      if (a > 0.5) { sum += a; sx += a * x; sy += a * y; if (y < top) top = y; }
    }
    if (sum < 20) return null;
    return { cx: sx / sum / 64 * W, cy: sy / sum / 38 * H, h: (sy / sum - top) / 38 * H };
  }
  function smoothPose(a, b) {
    if (!a || !b) return b;
    return { cx: (a.cx + b.cx) / 2, cy: (a.cy + b.cy) / 2, h: (a.h + b.h) / 2 };
  }
  function follow(g, from, draw) {
    if (!from || !livePose) { draw(); return; }
    const s = Math.max(0.85, Math.min(1.18, livePose.h / Math.max(1, from.h)));
    let tx = livePose.cx - s * from.cx, ty = livePose.cy - s * from.cy;
    const lim = W * 0.2; tx = Math.max(-lim, Math.min(lim, tx)); ty = Math.max(-lim, Math.min(lim, ty));
    g.save(); g.setTransform(s, 0, 0, s, tx, ty); draw(); g.restore();
  }

  // ---------- server ----------
  const ready = [];
  async function connect() {
    try {
      const m = await (await fetch("/config", { cache: "no-store" })).json();
      if (m.width !== W || m.height !== H) { W = m.width; H = m.height; sizeCanvases(); }
      stat.engine = m.engine; stat.references = m.references;
      if (lookSeen === null) lookSeen = m.look;
      online = true; ready.splice(0).forEach(f => f(m)); pump();
    } catch (e) { online = false; setTimeout(connect, 2000); }
  }
  const offline = () => { online = false; flying = 0; setTimeout(connect, 2000); };

  // the look is tuned live on /panel: when it changes, repaint the world and the avatar straight away
  let lookSeen = null;
  setInterval(async () => {
    if (!online) return;
    try {
      const m = await (await fetch("/config", { cache: "no-store" })).json();
      if (lookSeen !== null && m.look !== lookSeen) { refresh(); if (bgPrompt) setBackground(bgPrompt); }
      lookSeen = m.look;
    } catch (e) {}
  }, 1500);

  // the person: up to two frames in the pipeline, so the GPU never waits for the browser
  const MAX_FLYING = 2;
  let pumpTimer = 0;
  const schedule = (ms) => { clearTimeout(pumpTimer); pumpTimer = setTimeout(pump, ms); };
  async function pump() {
    if (!fgPrompt || scene || flying >= MAX_FLYING || !online) return;
    if (!video.videoWidth) { schedule(100); return; }
    // if you haven't moved, don't make a new frame: a still person stays perfectly still
    const sig = signature();
    if (lastSig && moved(sig, lastSig) < 1.5) { schedule(60); return; }
    lastSig = sig;
    flying++;
    const mine = ++seq, prompt = fgPrompt;
    // you, cut out and placed on the background, so the light and colours blend
    const s = send.getContext("2d");
    drawBackground(s);
    s.drawImage(cutout(grab, mask), 0, 0);
    const myMask = mk(); myMask.getContext("2d").drawImage(mask, 0, 0);
    const myPose = poseOf(mask);
    schedule(Math.max(40, stat.ms * 0.5));               // start the next one about halfway through this one
    try {
      const jpeg = await new Promise(r => send.toBlob(r, "image/jpeg", 0.85));
      const q = "prompt=" + encodeURIComponent(prompt);     // all tuning is on the server (/panel)
      const res = await fetch("/frame?" + q, { method: "POST", body: jpeg, headers: { "Content-Type": "image/jpeg" } });
      if (!res.ok) throw new Error("status " + res.status);
      stat.ms = +res.headers.get("X-Gen-Ms") || 0;
      const bmp = await createImageBitmap(await res.blob());
      flying--;
      if (mine < shownSeq || prompt !== fgPrompt) { bmp.close(); pump(); return; }   // late or out of date: skip it
      shownSeq = mine;
      const now = performance.now();
      if (person) {                                       // keep the current frame to fade out from
        const pc = prevCut.getContext("2d"); pc.clearRect(0, 0, W, H); pc.drawImage(cutout(person, personMask), 0, 0);
        prevPose = personPose;
        person.close();
        fade = Math.min(220, Math.max(60, (now - personAt) * 0.7));
      }
      person = bmp; personAt = now; personPose = myPose;
      fitMask(bmp, myMask);
      stat.times.push(now); while (stat.times.length && now - stat.times[0] > 2000) stat.times.shift();
      pump();
    } catch (e) { offline(); }
  }

  // a tiny greyscale thumbnail of the camera, to tell whether anything moved since the last frame
  function signature() {
    const g = tiny.getContext("2d", { willReadFrequently: true });
    g.drawImage(grab, 0, 0, 32, 20);
    const d = g.getImageData(0, 0, 32, 20).data, s = new Float32Array(640);
    for (let i = 0; i < 640; i++) s[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
    return s;
  }
  function moved(a, b) { let t = 0; for (let i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]); return t / a.length; }
  const refresh = () => { lastSig = null; };

  async function setBackground(prompt) {
    bgPrompt = prompt || null;
    if (!bgPrompt) { oldBg = null; bgImg = null; refresh(); return; }
    stat.note = "making background…";
    try {
      const res = await fetch("/background?prompt=" + encodeURIComponent(bgPrompt), { cache: "no-store" });
      if (!res.ok) throw new Error("status " + res.status);
      stat.bgMs = +res.headers.get("X-Gen-Ms") || 0;
      const img = await createImageBitmap(await res.blob());
      if (prompt !== bgPrompt) { img.close(); return; }   // a newer background was asked for meanwhile
      oldBg = bgImg; bgImg = img; bgAt = performance.now(); refresh();
      stat.note = "";
    } catch (e) { stat.note = ""; offline(); }
  }
  function setPerson(prompt) {
    fgPrompt = prompt || null;
    stat.times.length = 0;
    refresh();
    if (!fgPrompt && person) { person.close(); person = null; }
    pump();
  }
  function setScene(fn) { scene = fn || null; refresh(); if (!scene) pump(); }

  startSegmenter();
  const camera = startCamera();
  connect();
  return {
    stat, setPerson, setBackground, setScene, refresh, camera,
    whenReady: () => online ? Promise.resolve() : new Promise(r => ready.push(r)),
    get size() { return { W, H }; },
    reconnect: offline,
  };
}
