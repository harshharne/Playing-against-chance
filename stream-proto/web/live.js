// The live engine shared by the lab page (index.html) and the game (game.html):
// camera -> person cut-out -> generated person over a generated background, drawn into one canvas.
//
//   const live = createLive({ out, video, params });   params() -> { look? }   look: "pixel" | "line" | "matrix" | ""
//   (a browser filter; leave it out to use the look picked on /panel)
//   Everything about the painting itself (change, style, LoRAs, steadiness) is tuned on /panel and lives on the server.
//   live.setPerson("a baby girl ...")     // null = show the real you (or nothing)
//   live.setPerson(a, b, 0.3)             // 30% of the way from prompt a to prompt b (the avatar ages smoothly)
//   await live.setBackground("a village") // null = your real room (the lab page: one picture)
//   await live.world(prompt, { from, keep, frames, dur, seed, event, ... })   // the game: the world CHANGES to this scene,
//                                         // painted as a run of pictures the screen dissolves through (see world() below)
//   live.hold(true)                       // freeze the screen (while the die rolls); hold(false) lets go
//   live.setReal(false)                   // never show the raw camera (the game: only the painted avatar, or nobody)
//   live.setPersonAlpha(a)                // fade the painted avatar in / out (the kid emerging from the baby)
//   live.setControl({ age, ramp })        // sent with every frame: the avatar's age (its proportions) and the takeover ramp
//   live.where() / live.skinTone()        // where you are in the camera (0..1); your skin colour [r, g, b], from the camera
// The output canvas is drawn at OUT_SCALE x the painting size (from /config), so big worlds keep their detail,
// and the world gets a little depth (parallax.js) when the server sends its depth map.
//   live.setScene(fn)                     // draw your own scene instead (fn(ctx, W, H, now)); null = back to live
//   live.avatarMode()                     // "portrait" (the animator is there and /panel says so) or "painted"
//   await live.portrait(jpegBlob, { fade })   // the game's avatar: a painted portrait of you, moved live by your face
//                                         // (LivePortrait on the server), cut out and standing in the world. A second
//                                         // call dissolves into the new one over `fade` ms, both moving with you. null = none
//   live.photo()                          // a still of the camera (mirrored), to paint the portraits from
//   live.setPortraitPlace({ x, scale })   // where the portrait stands (x: 0..1 across); null = the middle
//   live.stat                             // fps, timings, notes for a status line

import { findCamera, builtInCamera, listCameras, saveCamera } from "./cameras.js";
import { createParallax } from "./parallax.js";

export function createLive({ out, video, params }) {
  const octx = out.getContext("2d");
  let W = 640, H = 384, S = 2;                              // painting size, and how much bigger the screen canvas is
  const mk = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
  let grab, mask, personMask, fg, send, prevCut, gen;      // working canvases, sized once the server tells us W x H
  const tiny = Object.assign(document.createElement("canvas"), { width: 32, height: 20 });       // "has anything moved?"
  const poseCanvas = Object.assign(document.createElement("canvas"), { width: 64, height: 38 }); // "where is the body?"

  let online = false, fgPrompt = null, fgTo = "", fgMix = 0, bgPrompt = null, flying = 0, seq = 0, shownSeq = 0;
  let person = null, personAt = 0, fade = 150, lastSig = null, held = false;
  let showReal = true, personAlpha = 1, control = null, serverPose = false;
  const px = createParallax(); let par = [0, 0], parallax = 0.03, dissolve = 0.5, pushAmt = 0.02, serverHead = null;
  let personPose = null, prevPose = null, livePose = null, avatarCfg = "painted", animatorCfg = false;
  let segmenter = null, segImage = null, segOk = false, camCover = 0, scene = null;
  const stat = { ms: 0, bgMs: 0, times: [], note: "", seg: "", online: false, engine: "", references: true, fps: "–" };

  function sizeCanvases() {
    out.width = W * S; out.height = H * S;
    [grab, mask, personMask, fg, send, prevCut, gen] = [mk(), mk(), mk(), mk(), mk(), mk(), mk()];
  }
  sizeCanvases();

  // ---------- camera ----------
  async function openCamera(id) {
    const want = { width: 1280, height: 720 };
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    try { video.srcObject = await navigator.mediaDevices.getUserMedia({ video: id ? { ...want, deviceId: { exact: id } } : want, audio: false }); stat.camNote = ""; }
    catch (e) {                                             // that camera is gone or busy: use the default, and say so (debug line, D)
      stat.camNote = `the chosen camera didn't open (${e.name}), using the default`;
      video.srcObject = await navigator.mediaDevices.getUserMedia({ video: want, audio: false });
    }
    const tr = video.srcObject.getVideoTracks()[0];
    stat.camera = tr ? tr.label : "";
    await video.play();
  }
  async function startCamera() {
    let cam = "";                                           // the avatar camera chosen on /dice.html (or with C in the game), if any
    try { cam = (await findCamera("pac-avatar-cam")) || (await builtInCamera()); } catch (e) {}   // else the Mac's own camera
    await openCamera(cam);
    requestAnimationFrame(render);
  }
  // the next camera in the list becomes the avatar camera, and is remembered (the game's C key)
  async function nextCamera() {
    const cams = await listCameras();
    if (!cams.length) return "";
    const tr = video.srcObject && video.srcObject.getVideoTracks()[0];
    const now = tr ? tr.getSettings().deviceId : "";
    const next = cams[(cams.findIndex(c => c.deviceId === now) + 1) % cams.length];
    saveCamera("pac-avatar-cam", next);
    await openCamera(next.deviceId);
    refresh();
    return stat.camera || next.label;
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
      vision = { mod: await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${v}/vision_bundle.mjs`), files };
      segmenter = await ImageSegmenter.createFromOptions(files, opts("VIDEO"));   // you, in the camera
      segImage = await ImageSegmenter.createFromOptions(files, opts("IMAGE"));    // the person the model drew
      segOk = true;
    } catch (e) {
      console.warn("segmentation unavailable:", e);
      stat.seg = "no person cut-out (segmenter didn't load: check internet)";
    }
  }
  // ---------- your joints, for the pose ControlNet (only while SHAPE = pose on /panel) ----------
  let vision = null, poser = null, poserLoading = false, shapeMode = "depth";
  async function startPoser() {
    if (poser || poserLoading || !vision) return;
    poserLoading = true;
    try {
      poser = await vision.mod.PoseLandmarker.createFromOptions(vision.files, {
        baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task", delegate: "GPU" },
        runningMode: "VIDEO", numPoses: 1,
      });
    } catch (e) { console.warn("pose unavailable:", e); stat.seg = "no pose reader (didn't load: check internet)"; }
    poserLoading = false;
  }
  let poseT = 0;
  function joints() {                                     // MediaPipe's 33 points as [x, y, visibility], or null
    if (shapeMode !== "pose" && shapeMode !== "both") return null;
    if (serverPose) return null;                            // the server reads the whole body itself (DWPose, on the GPU)
    if (!poser) { startPoser(); return null; }
    try {
      poseT = Math.max(poseT + 1, performance.now());
      const res = poser.detectForVideo(grab, poseT);
      const lm = res.landmarks && res.landmarks[0];
      if (!lm) return [];
      return lm.map(p => [+p.x.toFixed(4), +p.y.toFixed(4), +(p.visibility ?? 1).toFixed(2)]);
    } catch (e) { return null; }
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

  // ---------- the world: a playlist of painted pictures ----------
  // worlds[0] is on screen (or being left); worlds[1] is soaking in over it; the rest wait their turn. A fade that has
  // started always finishes, so the picture never jumps: a change of plan only drops the pictures that haven't started.
  const worlds = [];                                         // { img, depth, id, fade (ms), ease, push, seed, shown }
  let wk = 0, wTick = 0;                                     // how far worlds[1] is in (0..1); when the world's clock last moved
  // a run of pictures moves at one speed: it eases in on the first and out on the last; a single picture does both
  const EASE = { lin: k => k, in: k => k * k * (2 - k), out: k => 1 - (1 - k) * (1 - k) * (1 + k), inout: k => k * k * (3 - 2 * k) };
  function freeWorld(w) {                                    // a picture that's gone: give its memory back (it adds up over a life)
    if (px) { px.forget(w.img); if (w.depth) px.forget(w.depth); }
    try { w.img.close(); if (w.depth) w.depth.close(); } catch (e) {}
    if (w.shown) { const f = w.shown; w.shown = null; f(false); }
  }
  function landed(w) {                                       // fully in
    stat.worldId = w.id;
    if (w.shown) { const f = w.shown; w.shown = null; f(true); }
    refresh();
  }
  function stepWorld(now) {
    const dt = Math.min(100, Math.max(0, now - (wTick || now))); wTick = now;   // (a hold or a hidden tab doesn't skip ahead)
    if (worlds.length < 2) { wk = 0; return; }
    wk += dt / worlds[1].fade;
    while (worlds.length > 1 && wk >= 1) {
      const left = (wk - 1) * worlds[1].fade;
      freeWorld(worlds.shift());
      landed(worlds[0]);
      wk = worlds.length > 1 ? left / worlds[1].fade : 0;
    }
  }
  function addWorld(w) { worlds.push(w); if (worlds.length === 1) landed(w); }
  function cutWorlds() {                                     // -> the id of the picture that will be on screen
    for (const w of worlds.splice(worlds.length > 1 && wk > 0 ? 2 : Math.min(1, worlds.length))) freeWorld(w);
    return worlds.length ? worlds[worlds.length - 1].id : 0;
  }
  function clearWorlds() { for (const w of worlds.splice(0)) freeWorld(w); wk = 0; }
  setInterval(() => { if (document.hidden && !held) stepWorld(performance.now()); }, 250);   // a hidden tab draws nothing: keep the world's clock going

  // ---------- the screen ----------
  function drawBackground(g) {
    if (!worlds.length) { if (showReal) g.drawImage(grab, 0, 0); else { g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); } return; }   // no background: your room stays
    const a = worlds[0], b = worlds[1] || null, k = b ? EASE[b.ease](Math.min(1, wk)) : 0;
    if (g === octx && px && px.ok) {                           // the screen: the world in depth, following you, one picture soaking into the next
      // your head, as found on the GPU machine (X-Head on each frame); the browser's own outline when it hasn't sent one
      const sh = serverHead && performance.now() - serverHead.at < 800 ? serverHead : null;
      const p = sh ? [-(sh.x - 0.5), -(sh.y - 0.45) * 0.6] : livePose ? [-(livePose.cx / W - 0.5), -(livePose.cy / H - 0.5) * 0.6] : [0, 0];
      const drift = [Math.sin(performance.now() / 5200) * 0.12, Math.cos(performance.now() / 7300) * 0.06];
      par = [par[0] + ((p[0] + drift[0]) * parallax - par[0]) * 0.06, par[1] + ((p[1] + drift[1]) * parallax - par[1]) * 0.06];
      const cv = px.render(W * S, H * S, a, b, k, par[0], par[1], b ? { wet: dissolve, push: b.push, seed: b.seed } : {});
      if (cv) { g.drawImage(cv, 0, 0, W, H); return; }
    }
    g.globalAlpha = 1; g.drawImage(a.img, 0, 0, W, H);        // flat (no WebGL, or the copy the painter gets): a plain crossfade
    if (b) { g.globalAlpha = k; g.drawImage(b.img, 0, 0, W, H); g.globalAlpha = 1; }
  }
  function render(now) {
    if (held) { requestAnimationFrame(render); return; }      // everything holds still (the die is rolling)
    stepWorld(now);
    octx.setTransform(S, 0, 0, S, 0, 0);                       // draw in painting units on the bigger screen canvas
    if (capture()) {
      segment();
      if (scene) scene(octx, W, H, now);                                     // a drawn scene (e.g. birth)
      else if (!fgPrompt && !bgPrompt) { if (showReal) octx.drawImage(grab, 0, 0); else { octx.fillStyle = "#fff"; octx.fillRect(0, 0, W, H); } }   // nothing set: just you
      else {
        drawBackground(octx);
        livePose = smoothPose(livePose, poseOf(mask));
        if (P.main && personAlpha > 0.003) drawPortrait(octx, now);          // you, as your portrait at this age
        else if (fgPrompt && person && personAlpha > 0.003) {                // the re-imagined you
          octx.globalAlpha = personAlpha;
          follow(octx, personPose, () => octx.drawImage(cutout(person, personMask), 0, 0));
          const k = Math.min(1, (performance.now() - personAt) / fade);
          if (k < 1) { octx.globalAlpha = (1 - k) * personAlpha; follow(octx, prevPose, () => octx.drawImage(prevCut, 0, 0)); }
          octx.globalAlpha = 1;
        } else if (worlds.length && showReal && !fgPrompt) octx.drawImage(cutout(grab, mask), 0, 0);   // the real you, on the new background
      }
      applyLook(params().look ?? stat.filter, now);                          // the look's filter (from /panel), on everything
      octx.setTransform(1, 0, 0, 1, 0, 0);
    }
    const t = stat.times;
    stat.fps = t.length > 1 ? ((t.length - 1) / ((t[t.length - 1] - t[0]) / 1000)).toFixed(1) : "–";
    stat.online = online;
    requestAnimationFrame(render);
  }

  // ---------- the look: a filter over the finished frame, so the world always looks the same ----------
  // "pixel": big blocks, each colour channel cut to a few levels, with a checkerboard dither (the classic 8-bit trick).
  // "line": ink outlines on paper. "matrix": the picture rebuilt from glowing green glyphs, with code rain.
  // Anything else: as generated. Which one comes from the look picked on /panel (styles.json "filter").
  const PIXEL = 4;                                            // size of one 8-bit pixel, in picture pixels
  const LEVELS = 6;                                           // per colour channel: 6 x 6 x 6 = 216 colours
  const DITHER = 0.3;                                         // 0 = flat bands, 1 = heavy checkerboard
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v / 16 - 0.47) * DITHER);
  const lookCanvas = document.createElement("canvas");
  let lastLook = null;
  function applyLook(look, now) {
    if (look !== lastLook) { out.style.imageRendering = look === "pixel" ? "pixelated" : "auto"; lastLook = look; }
    if (look === "pixel") pixelate(PIXEL);
    else if (look === "line") lineDrawing();
    else if (look === "matrix") matrix(now);
  }
  const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜ0123456789Z:.=*+-<>";
  const CELL = 10;                                            // one glyph, in picture pixels
  let rainSeed = null;
  function matrix(now) {
    const cw = Math.round(W / CELL), ch = Math.round(H / CELL);
    if (!rainSeed || rainSeed.length !== cw) rainSeed = Array.from({ length: cw }, () => [Math.random() * ch * 3, 0.6 + Math.random() * 0.9]);
    lookCanvas.width = cw; lookCanvas.height = ch;
    const g = lookCanvas.getContext("2d", { willReadFrequently: true });
    g.drawImage(out, 0, 0, cw, ch);
    const d = g.getImageData(0, 0, cw, ch).data;
    octx.fillStyle = "#020a04"; octx.fillRect(0, 0, W, H);
    octx.font = `${CELL + 1}px ui-monospace, Menlo, monospace`; octx.textAlign = "center"; octx.textBaseline = "middle";
    const t = now / 1000;
    for (let x = 0; x < cw; x++) {
      const [seed, speed] = rainSeed[x], head = (seed + t * speed * 14) % (ch * 3);   // where this column's drop is
      for (let y = 0; y < ch; y++) {
        const o = (y * cw + x) * 4, lum = (d[o] * 0.3 + d[o + 1] * 0.59 + d[o + 2] * 0.11) / 255;
        const dist = head - y, rain = dist >= 0 && dist < 10 ? 1 - dist / 10 : 0;
        const a = Math.min(1, lum * 1.15 + rain * 0.55);
        if (a < 0.07) continue;
        octx.fillStyle = dist >= 0 && dist < 1 ? `rgba(220,255,225,${a})` : `rgba(70,255,110,${a})`;
        const gi = (x * 7 + y * 13 + Math.floor(t * 2 + seed)) % GLYPHS.length;
        octx.fillText(GLYPHS[gi], x * CELL + CELL / 2, y * CELL + CELL / 2);
      }
    }
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
    g.save(); g.translate(tx, ty); g.scale(s, s); draw(); g.restore();   // (on top of the screen's own scale)
  }


  // ---------- the portrait: your face painted at your age, moved live by you, standing in the world ----------
  // The server's animator (LivePortrait) moves the portrait with your face: camera frames go out over a WebSocket,
  // the moved portrait comes back. During an age change it moves TWO portraits with the same motion (the one you
  // were and the one you're becoming) and they dissolve into each other here, both alive. Each is cut out of its
  // plain background (MediaPipe, on the portrait itself, refreshed as it moves) and stands at the bottom of the
  // world, growing with your age, drifting a little with your head.
  const P = { ws: null, flying: 0, sentAt: 0, main: null, next: null, k: 0, fade: 2000, t0: 0, stage: "one",
              done: null, x: 0.5, place: null, cut: null, mix: null, sendCanvas: null };
  function pStream() { return { bmp: null, matte: document.createElement("canvas"), mattedAt: 0, alpha: null, cut: document.createElement("canvas"), cutOf: null, cutV: -1, matteV: 0 }; }
  const PFLY = 2;                                            // two frames in flight: the network's wait overlaps the GPU's work
  function pConnect() {
    if (P.ws && P.ws.readyState <= 1) return;
    P.ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/animate");
    P.ws.binaryType = "arraybuffer";
    P.ws.onopen = () => { P.flying = 0; };
    P.ws.onclose = () => { P.ws = null; P.flying = 0; if (P.main) setTimeout(pConnect, 1500); };
    P.ws.onmessage = async (e) => {
      const buf = e.data, n = new DataView(buf).getUint32(0);
      const info = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
      const all = new Uint8Array(buf, 4 + n), a = info.next ? all.subarray(0, info.jpeg) : all, b = info.next ? all.subarray(info.jpeg) : null;
      P.flying = Math.max(0, P.flying - 1);
      if (info.head) { serverHead = { x: info.head.x, y: info.head.y, at: performance.now() }; stat.headBy = "animator"; }
      stat.portraitNote = info.note || ""; stat.portraitMs = info.ms ? Math.round(info.ms.total) : 0;
      if (a.length && P.main) {
        const [ba, bb] = await Promise.all([createImageBitmap(new Blob([a], { type: "image/jpeg" })), b && b.length ? createImageBitmap(new Blob([b], { type: "image/jpeg" })) : null]);
        if (!P.main) { ba.close(); if (bb) bb.close(); return; }
        if (P.stage === "promoting" && !bb) {               // the incoming portrait is the portrait now
          P.stage = "one"; swapIn(P.main, ba); P.next = null; finishAge(true);
        } else {
          swapIn(P.main, ba);
          if (bb && P.next) { swapIn(P.next, bb); if (!P.t0) P.t0 = performance.now(); }   // the dissolve starts with its first frame
          else if (bb) bb.close();
        }
        stat.times.push(performance.now()); while (stat.times.length && performance.now() - stat.times[0] > 2000) stat.times.shift();
      }
    };
  }
  function swapIn(st, bmp) { if (st.bmp) st.bmp.close(); st.bmp = bmp; }
  setInterval(() => { if (P.flying && performance.now() - P.sentAt > 4000) P.flying = 0; }, 1000);   // never stall
  // camera frames are encoded in a worker (encoder.js), so the busy main thread never slows the portrait down
  let enc = null;
  try { enc = new Worker(new URL("./encoder.js", import.meta.url)); } catch (e) { enc = null; }
  if (enc) enc.onmessage = (e) => {
    if (!e.data || !P.ws || P.ws.readyState !== 1) { P.flying = Math.max(0, P.flying - 1); return; }
    P.ws.send(e.data);
  };
  function pSend() {                                         // the next frame goes as soon as one comes back
    if (!P.main || held || P.flying >= PFLY || !P.ws || P.ws.readyState !== 1 || !video.videoWidth) return;
    if (P.flying && performance.now() - P.sentAt < 15) return;   // (not two at once)
    P.flying++; P.sentAt = performance.now();
    const w = 480, h = Math.round(w * video.videoHeight / video.videoWidth);
    if (enc) {
      createImageBitmap(video, { resizeWidth: w, resizeHeight: h, resizeQuality: "low" })
        .then(bmp => enc.postMessage({ bmp, w, h, q: 0.8 }, [bmp]))
        .catch(() => { P.flying = Math.max(0, P.flying - 1); });
      return;
    }
    const c = P.sendCanvas || (P.sendCanvas = document.createElement("canvas"));   // (no workers: on the page)
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext("2d"); g.save(); g.translate(w, 0); g.scale(-1, 1); g.drawImage(video, 0, 0, w, h); g.restore();   // as in a mirror
    c.toBlob(async (bl) => { if (!bl || !P.ws || P.ws.readyState !== 1) { P.flying = Math.max(0, P.flying - 1); return; } P.ws.send(await bl.arrayBuffer()); }, "image/jpeg", 0.8);
  }
  // the portrait's outline: MediaPipe on the moved portrait, at most ~8 times a second per portrait (the head moves
  // inside a still painting, so the outline barely changes); a soft head-and-shoulders shape if MediaPipe isn't there
  const SEG = 256;
  const segCanvas = Object.assign(document.createElement("canvas"), { width: SEG, height: SEG });
  function matteOf(st, now) {
    const m = st.matte;
    if (m.width !== SEG) { m.width = m.height = SEG; st.mattedAt = 0; }
    if (now - st.mattedAt < 120 && st.mattedAt) return m;
    st.mattedAt = now;
    const g = m.getContext("2d");
    if (segImage && st.bmp) {
      const sg = segCanvas.getContext("2d"); sg.clearRect(0, 0, SEG, SEG); sg.drawImage(st.bmp, 0, 0, SEG, SEG);
      try {
        segImage.segment(segCanvas, (res) => {
          const conf = res.confidenceMasks && res.confidenceMasks[0]; if (!conf) return;
          const f = conf.getAsFloat32Array();
          let cover = 0;
          for (let i = 0; i < f.length; i++) cover += f[i];
          if (cover / f.length < 0.08) return;               // no person found in it: keep the last outline
          const first = !st.alpha;
          if (first) st.alpha = new Float32Array(f.length);
          const data = g.createImageData(SEG, SEG), d = data.data;
          for (let i = 0, j = 3; i < f.length; i++, j += 4) {   // blend toward the new outline, so it never flickers
            const v = f[i] > 0.2 ? Math.min(1, f[i] * 1.2) : 0;
            st.alpha[i] = first ? v : st.alpha[i] * 0.4 + v * 0.6;
            d[j] = st.alpha[i] * 255;
          }
          g.putImageData(data, 0, 0);
          st.segOk = true; st.matteV++;
        });
      } catch (e) {}
    }
    if (!st.segOk) {                                         // a soft bust: a head and a pair of shoulders
      g.clearRect(0, 0, SEG, SEG); g.fillStyle = "#000"; g.filter = "blur(10px)";
      g.beginPath(); g.ellipse(SEG * 0.5, SEG * 0.42, SEG * 0.2, SEG * 0.26, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(SEG * 0.5, SEG * 1.02, SEG * 0.46, SEG * 0.3, 0, 0, Math.PI * 2); g.fill();
      g.filter = "none"; st.matteV++;
    }
    return m;
  }
  function cutPortrait(st, now, size) {                      // the portrait without its background, its bottom melting into the world
    const c = st.cut, m = matteOf(st, now);
    if (c.width === size && st.cutOf === st.bmp && st.cutV === st.matteV) return c;   // nothing new since the last cut
    if (c.width !== size) { c.width = c.height = size; }
    st.cutOf = st.bmp; st.cutV = st.matteV;
    const g = c.getContext("2d");
    g.clearRect(0, 0, size, size);
    g.drawImage(st.bmp, 0, 0, size, size);
    g.globalCompositeOperation = "destination-in"; g.filter = "blur(2px)"; g.drawImage(m, 0, 0, size, size); g.filter = "none";
    g.globalCompositeOperation = "destination-out";
    const gr = g.createLinearGradient(0, size * 0.8, 0, size); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,1)");
    g.fillStyle = gr; g.fillRect(0, size * 0.8, size, size * 0.2);
    g.globalCompositeOperation = "source-over";
    return c;
  }
  function drawPortrait(g, now) {
    pSend();
    if (!P.main.bmp) return;
    const age = control && control.age != null ? +control.age : 30;
    const pl = P.place || {}, home = pl.x ?? 0.5;
    const side = H * (0.66 + 0.3 * Math.max(0, Math.min(1, (age - 4) / 14))) * (pl.scale || 1);   // a child stands smaller in the world
    const sh = serverHead && performance.now() - serverHead.at < 800 ? serverHead : null;
    P.x += ((sh ? home + (sh.x - 0.5) * 0.5 : home) - P.x) * 0.05;                 // drifts a little with you, never off screen
    const x = Math.max(0, Math.min(W - side, P.x * W - side / 2)), y = H - side;
    const px2 = Math.round(side * S);                        // cut at screen resolution
    let k = 0;
    if (P.next && P.next.bmp && P.t0) {
      const r = Math.min(1, (now - P.t0) / P.fade); k = r * r * (3 - 2 * r);
      if (r >= 1 && P.stage === "two") { P.stage = "promoting"; if (P.ws && P.ws.readyState === 1) P.ws.send(JSON.stringify({ cmd: "promote" })); }
    }
    if (P.stage === "promoting") k = 1;
    g.globalAlpha = personAlpha;
    if (k <= 0.001 || !(P.next && P.next.bmp)) g.drawImage(cutPortrait(P.main, now, px2), x, y, side, side);
    else if (k >= 0.999) g.drawImage(cutPortrait(P.next, now, px2), x, y, side, side);
    else {                                                   // a true crossfade of two cut-outs (their outlines differ: added, not stacked)
      const m = P.mix || (P.mix = document.createElement("canvas"));
      if (m.width !== px2) { m.width = m.height = px2; }
      const mg = m.getContext("2d"); mg.clearRect(0, 0, px2, px2);
      mg.globalAlpha = 1 - k; mg.drawImage(cutPortrait(P.main, now, px2), 0, 0);
      mg.globalAlpha = k; mg.globalCompositeOperation = "lighter"; mg.drawImage(cutPortrait(P.next, now, px2), 0, 0);
      mg.globalCompositeOperation = "source-over"; mg.globalAlpha = 1;
      g.drawImage(m, x, y, side, side);
    }
    g.globalAlpha = 1;
  }
  function finishAge(ok) { const f = P.done; P.done = null; P.t0 = 0; if (f) f(ok); }
  async function portrait(blob, { fade = 2000 } = {}) {
    if (!blob) {                                             // no portrait: back to nothing
      if (P.ws && P.ws.readyState === 1) P.ws.send(JSON.stringify({ cmd: "drop" }));
      for (const st of [P.main, P.next]) if (st && st.bmp) st.bmp.close();
      P.main = P.next = null; P.stage = "one"; finishAge(false); return true;
    }
    pConnect();
    if (!P.main) {                                           // the first: set it, and it's there as soon as frames come
      const r = await fetch("/animate/source", { method: "POST", body: blob }).then(r => r.json()).catch(() => ({ ok: false }));
      if (!r.ok) { stat.portraitNote = r.note || "the portrait couldn't be set"; return false; }
      P.main = pStream(); P.stage = "one";
      return true;
    }
    if (P.stage !== "one") {                                 // a change is under way: let it land first (it never jumps)
      await new Promise(r => { const t = setInterval(() => { if (P.stage === "one") { clearInterval(t); r(); } }, 100); });
    }
    const r = await fetch("/animate/source?slot=next", { method: "POST", body: blob }).then(r => r.json()).catch(() => ({ ok: false }));
    if (!r.ok || !P.main) { stat.portraitNote = r.note || "the next portrait couldn't be set"; return false; }
    P.next = pStream(); P.fade = Math.max(300, fade); P.t0 = 0; P.stage = "two";
    return new Promise(res => { P.done = res; });
  }
  function setPortraitPlace(p) { P.place = p || null; }      // where the portrait stands: { x: 0..1 across, scale } (null = the middle)
  function photo() {                                         // the camera, mirrored, full size
    if (!video.videoWidth) return Promise.resolve(null);
    const c = document.createElement("canvas"); c.width = video.videoWidth; c.height = video.videoHeight;
    const g = c.getContext("2d"); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(video, 0, 0);
    return new Promise(r => c.toBlob(r, "image/jpeg", 0.92));
  }

  // ---------- server ----------
  const ready = [];
  async function connect() {
    try {
      const m = await (await fetch("/config", { cache: "no-store" })).json();
      if (m.width !== W || m.height !== H || (m.out_scale || 2) !== S) { W = m.width; H = m.height; S = m.out_scale || 2; sizeCanvases(); }
      serverPose = !!m.server_pose; worldLook(m); avatarCfg = m.avatar || "painted"; animatorCfg = !!m.animator;
      stat.engine = m.engine; stat.references = m.references;
      if (lookSeen === null) { lookSeen = m.look; tuneSeen = m.tune; }
      stat.filter = m.filter || ""; stat.skip = m.skip_still;
      shapeMode = m.shape || "depth";
      online = true; ready.splice(0).forEach(f => f(m)); pump();
    } catch (e) { online = false; setTimeout(connect, 2000); }
  }
  const offline = () => { online = false; flying = 0; setTimeout(connect, 2000); };
  function worldLook(m) {                                    // tuned on /panel: parallax, how one world soaks into the next, the push
    parallax = m.parallax ?? parallax; dissolve = m.dissolve ?? dissolve; pushAmt = m.push ?? pushAmt;
    if (px) px.setPush(pushAmt);
  }

  // the look is tuned live on /panel: when it changes, repaint the world and the avatar straight away
  let lookSeen = null, tuneSeen = null;
  setInterval(async () => {
    if (!online) return;
    try {
      const m = await (await fetch("/config", { cache: "no-store" })).json();
      if (tuneSeen !== null && m.tune !== tuneSeen) refresh();                       // any setting: a fresh avatar frame
      if (lookSeen !== null && m.look !== lookSeen && lastWorld)                     // the look: the same world again (same seed), in the new look
        world(lastWorld.prompt, { ...lastWorld.o, from: "", base: "none", keep: 0, frames: 1, breath: 0, fresh: false, polite: false, dur: 800 });
      lookSeen = m.look; tuneSeen = m.tune; shapeMode = m.shape || "depth"; stat.filter = m.filter || ""; stat.skip = m.skip_still;
      serverPose = !!m.server_pose; worldLook(m); avatarCfg = m.avatar || "painted"; animatorCfg = !!m.animator;
      if ((shapeMode === "pose" || shapeMode === "both") && !serverPose) startPoser();
    } catch (e) {}
  }, 1000);

  // the person: up to two frames in the pipeline, so the GPU never waits for the browser
  const MAX_FLYING = 2;
  let pumpTimer = 0;
  const schedule = (ms) => { clearTimeout(pumpTimer); pumpTimer = setTimeout(pump, ms); };
  async function pump() {
    if (!fgPrompt || scene || held || flying >= MAX_FLYING || !online) return;
    if (!video.videoWidth) { schedule(100); return; }
    // if you haven't moved, don't make a new frame: a still person stays perfectly still
    const sig = signature();
    if (lastSig && moved(sig, lastSig) < (stat.skip ?? 1.5)) { schedule(60); return; }   // SKIP WHEN STILL, set on /panel
    lastSig = sig;
    flying++;
    const mine = ++seq, prompt = fgPrompt;
    const ageing = fgTo && fgMix > 0.001 ? `&to=${encodeURIComponent(fgTo)}&mix=${fgMix.toFixed(3)}` : "";
    // you, cut out and placed on the background, so the light and colours blend
    const s = send.getContext("2d");
    drawBackground(s);
    s.drawImage(cutout(grab, mask), 0, 0);
    const myMask = mk(); myMask.getContext("2d").drawImage(mask, 0, 0);
    const myPose = poseOf(mask);
    const pts = joints();
    schedule(Math.max(40, stat.ms * 0.5));               // start the next one about halfway through this one
    try {
      const jpeg = await new Promise(r => send.toBlob(r, "image/jpeg", 0.85));
      const q = "prompt=" + encodeURIComponent(prompt) + ageing;   // all tuning is on the server (/panel)
      const headers = { "Content-Type": "image/jpeg" };
      if (pts) headers["X-Pose"] = JSON.stringify(pts);
      if (stat.rtt) headers["X-RTT"] = String(Math.round(stat.rtt));   // so the panel can show where the time goes
      if (control) { if (control.age != null) headers["X-Age"] = (+control.age).toFixed(2); if (control.ramp != null) headers["X-Ramp"] = (+control.ramp).toFixed(3); }
      const sent = performance.now();
      const res = await fetch("/frame?" + q, { method: "POST", body: jpeg, headers });
      if (!res.ok) throw new Error("status " + res.status);
      stat.ms = +res.headers.get("X-Gen-Ms") || 0;
      const hh = res.headers.get("X-Head");
      if (hh) { const [hx, hy] = hh.split(",").map(Number); serverHead = { x: hx, y: hy, at: performance.now() }; stat.headBy = "server"; }
      const bmp = await createImageBitmap(await res.blob());
      stat.rtt = performance.now() - sent;                 // camera frame out -> painted frame back, as the browser sees it
      flying--;
      if (mine < shownSeq || !fgPrompt) { bmp.close(); pump(); return; }   // late (or the avatar was switched off): skip it
      // (a frame made for the previous age is still shown: that's what makes the ageing a morph, not a jump)
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

  // The world changes to this scene. The server paints the change as a run of pictures (POST /world, streamed): all
  // from the picture on screen, each repainted a little more, the words moving from the old scene to the new. They are
  // queued here as they arrive and the screen dissolves through them, so the whole run takes about `dur`.
  //   from    the scene on screen now (its words blend into the new ones)      keep    how much of the picture survives
  //   frames  how many pictures (1 = one)      dur   ms for the whole change     push  the view moves in through the run
  //   base    "last" (what's on screen) · "anchor" (this event's own world: a breath) · "none" (from noise)
  //   seed, event, breath   the life's seed, which event, which breath: what keeps one life looking like one life
  //   anchor  the last picture becomes the event's own world      fresh  a new life
  //   polite  a breath: never interrupts a change (resolves false at once if one is being painted)
  // Resolves true when the last picture is fully in; false if it was dropped for a newer change, skipped, or failed.
  let bgAsk = 0, worldCtl = null, lastWorld = null, changing = 0;
  async function world(prompt, o = {}) {
    const { from = "", keep = 0, frames = 1, base = "last", seed = 0, event = 0, breath = 0, anchor = true, fresh = false,
            polite = false, dur = 600, push = false } = o;
    bgPrompt = prompt || null;
    if (!bgPrompt) { bgAsk++; if (worldCtl) worldCtl.abort(); lastWorld = null; clearWorlds(); refresh(); return false; }
    if (polite && changing) return false;
    const ask = ++bgAsk;
    if (worldCtl) worldCtl.abort();                          // whatever was being painted: no longer wanted
    const ctl = worldCtl = new AbortController();
    const fromId = polite ? (worlds.length ? worlds[worlds.length - 1].id : 0) : cutWorlds();
    if (!polite) { lastWorld = { prompt, o }; changing++; }
    const n = Math.max(1, Math.round(frames)), each = Math.max(300, dur / n);
    let done, ok = false, got = 0, gap = 0, lastAt = 0, watchdog = 0;
    const finished = new Promise(r => { done = r; });
    const alive = () => { clearTimeout(watchdog); watchdog = setTimeout(() => ctl.abort(), 30000); };   // a stuck server never stalls the life
    stat.note = "painting the world…";
    try {
      alive();
      const res = await fetch("/world", { method: "POST", signal: ctl.signal, cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: bgPrompt, from, keep, frames: n, base, from_id: fromId, seed, event, breath, anchor, fresh, polite }) });
      if (!res.ok || !res.body) throw new Error("status " + res.status);
      const reader = res.body.getReader();
      let buf = new Uint8Array(0);
      read: for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        alive();
        const joined = new Uint8Array(buf.length + value.length); joined.set(buf); joined.set(value, buf.length); buf = joined;
        for (;;) {                                           // every whole message in the buffer: [4-byte length][json][jpeg][depth jpeg]
          if (buf.length < 4) break;
          const hl = new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0);
          if (buf.length < 4 + hl) break;
          const info = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + hl)));
          const j0 = 4 + hl, d0 = j0 + (info.jpeg || 0), endAt = d0 + (info.depth || 0);
          if (buf.length < endAt) break;
          const jpeg = buf.slice(j0, d0), dep = buf.slice(d0, endAt);
          buf = buf.slice(endAt);
          if (info.error) { stat.worldError = info.error; break read; }
          if (info.skipped) break read;
          stat.worldError = ""; stat.worldChange = info.change; stat.bgMs = info.ms; stat.worldTokens = info.tokens;
          const img = await createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }));
          let depth = null;
          if (info.depth) { try { depth = await createImageBitmap(new Blob([dep], { type: "image/jpeg" })); } catch (e) {} }
          if (ask !== bgAsk) { img.close(); if (depth) depth.close(); break read; }   // a newer change was asked for meanwhile
          const now = performance.now();
          if (got) gap = gap ? gap * 0.5 + (now - lastAt) * 0.5 : now - lastAt;       // how fast the painter is delivering
          lastAt = now; got++;
          addWorld({ img, depth, id: info.id, seed: info.id * 7.31, push: push ? pushAmt : 0,
            fade: info.final ? each : Math.max(each, gap * 1.05),                    // never dissolve faster than the pictures come
            ease: info.n === 1 ? "inout" : info.i === 1 ? "in" : info.final ? "out" : "lin",
            shown: info.final ? done : null });
          if (info.final) ok = true;
        }
      }
    } catch (e) { if (e.name !== "AbortError") offline(); }
    clearTimeout(watchdog);
    if (!polite) changing--;
    if (ask === bgAsk) stat.note = "";
    if (!ok) done(false);
    return finished;
  }
  // the lab page's simple way: one picture for the prompt (null = your real room)
  function setBackground(prompt, { keep = 0, fade = 600, fresh = false, base = "", anchor = true } = {}) {
    return world(prompt, { keep, dur: fade, fresh, anchor, base: base === "anchor" ? "anchor" : keep > 0 ? "last" : "none" });
  }
  function setPerson(prompt, to = "", mix = 0) {
    const same = (prompt || null) === fgPrompt && to === fgTo && Math.abs(mix - fgMix) < 0.002;
    if (same) return;
    if ((prompt || null) !== fgPrompt) stat.times.length = 0;
    fgPrompt = prompt || null; fgTo = to || ""; fgMix = mix || 0;
    refresh();
    if (!fgPrompt && person) { person.close(); person = null; }
    pump();
  }
  function hold(on) { held = !!on; if (!held) { refresh(); pump(); } }
  function setReal(on) { showReal = !!on; }
  function setPersonAlpha(a) { personAlpha = Math.max(0, Math.min(1, a)); }
  function setControl(c) { control = c ? { ...control, ...c } : null; }
  function where() { return livePose ? { x: livePose.cx / W, y: livePose.cy / H } : null; }
  // your skin colour, read from the camera inside the top part of your outline (your face), averaged
  function skinTone() {
    const b = poseOf(mask); if (!b) return null;
    const g = grab.getContext("2d", { willReadFrequently: true }), m = mask.getContext("2d", { willReadFrequently: true });
    const x0 = Math.max(0, Math.round(b.cx - b.h * 0.12)), y0 = Math.max(0, Math.round(b.cy - b.h * 0.95)), w = Math.round(b.h * 0.24), h = Math.round(b.h * 0.25);
    if (w < 4 || h < 4) return null;
    const d = g.getImageData(x0, y0, w, h).data, a = m.getImageData(x0, y0, w, h).data;
    let r = 0, gg = 0, bb = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (a[i + 3] > 180) { r += d[i]; gg += d[i + 1]; bb += d[i + 2]; n++; }
    return n > 20 ? [r / n, gg / n, bb / n] : null;
  }
  function setScene(fn) { scene = fn || null; refresh(); if (!scene) pump(); }

  startSegmenter();
  const camera = startCamera();
  connect();
  return {
    stat, setPerson, setBackground, world, setScene, portrait, photo, setPortraitPlace, avatarMode: () => (avatarCfg === "portrait" && animatorCfg ? "portrait" : "painted"),   // what can run now
    avatarWanted: () => avatarCfg,                           // what /panel asks for (the animator may still be loading)
    refresh, camera, hold, setReal, setPersonAlpha, setControl, where, skinTone, nextCamera,
    worldState: () => ({ queued: worlds.length, k: wk, textures: px ? px.textures : 0, webgl: !!(px && px.ok) }),
    whenReady: () => online ? Promise.resolve() : new Promise(r => ready.push(r)),
    get size() { return { W, H }; },
    reconnect: offline,
  };
}
