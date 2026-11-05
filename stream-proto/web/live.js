// The live engine shared by the lab page (index.html) and the game (game.html):
// camera -> person cut-out -> generated person over a generated background, drawn into one canvas.
//
//   const live = createLive({ out, video, params });   params() -> { look? }   look: "pixel" | "line" | "matrix" | ""
//   (a browser filter; leave it out to use the look picked on /panel)
//   Everything about the painting itself (change, style, LoRAs, steadiness) is tuned on /panel and lives on the server.
//   live.setPerson("a baby girl ...")     // null = show the real you (or nothing)
//   live.setPerson(a, b, 0.3)             // 30% of the way from prompt a to prompt b (the avatar ages smoothly)
//   await live.setBackground("a village") // null = your real room
//   await live.setBackground(p, { keep: 0.5, fade: 2500 })   // painted FROM the last world, crossfaded in over 2.5 s
//   live.hold(true)                       // freeze the screen (while the die rolls); hold(false) lets go
//   live.setReal(false)                   // never show the raw camera (the game: only the painted avatar, or nobody)
//   live.setPersonAlpha(a)                // fade the painted avatar in / out (the kid emerging from the baby)
//   live.setControl({ age, ramp })        // sent with every frame: the avatar's age (its proportions) and the takeover ramp
//   live.where() / live.skinTone()        // where you are in the camera (0..1); your skin colour [r, g, b], from the camera
// The output canvas is drawn at OUT_SCALE x the painting size (from /config), so big worlds keep their detail,
// and the world gets a little depth (parallax.js) when the server sends its depth map.
//   live.setScene(fn)                     // draw your own scene instead (fn(ctx, W, H, now)); null = back to live
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
  let bgImg = null, oldBg = null, bgAt = 0, bgFade = 600, person = null, personAt = 0, fade = 150, lastSig = null, held = false;
  let bgDepth = null, oldPair = null, showReal = true, personAlpha = 1, control = null, serverPose = false;
  const px = createParallax(); let par = [0, 0], parallax = 0.03;
  let personPose = null, prevPose = null, livePose = null;
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

  // ---------- the screen ----------
  function drawBackground(g) {
    if (!bgImg) { if (showReal) g.drawImage(grab, 0, 0); else { g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); } return; }   // no background: your room stays
    let k = Math.min(1, (performance.now() - bgAt) / bgFade);
    k = k * k * (3 - 2 * k);                                  // ease in and out: a slow paint-over, no visible start or stop
    if (g === octx && px && parallax > 0) {                    // the screen: the world with a little depth, following you
      const p = livePose ? [-(livePose.cx / W - 0.5), -(livePose.cy / H - 0.5) * 0.6] : [0, 0];
      const drift = [Math.sin(performance.now() / 5200) * 0.12, Math.cos(performance.now() / 7300) * 0.06];
      par = [par[0] + ((p[0] + drift[0]) * parallax - par[0]) * 0.06, par[1] + ((p[1] + drift[1]) * parallax - par[1]) * 0.06];
      const o = oldPair && k < 1 ? oldPair : null;
      g.drawImage(px.render(W * S, H * S, o ? o.img : bgImg, o ? o.depth : bgDepth, bgImg, bgDepth, o ? k : 1, par[0], par[1]), 0, 0, W, H);
      return;
    }
    if (oldBg && k < 1) { g.globalAlpha = 1; g.drawImage(oldBg, 0, 0, W, H); g.globalAlpha = k; }
    g.drawImage(bgImg, 0, 0, W, H);
    g.globalAlpha = 1;
  }
  function render(now) {
    if (held) { requestAnimationFrame(render); return; }      // everything holds still (the die is rolling)
    octx.setTransform(S, 0, 0, S, 0, 0);                       // draw in painting units on the bigger screen canvas
    if (capture()) {
      segment();
      if (scene) scene(octx, W, H, now);                                     // a drawn scene (e.g. birth)
      else if (!fgPrompt && !bgPrompt) { if (showReal) octx.drawImage(grab, 0, 0); else { octx.fillStyle = "#fff"; octx.fillRect(0, 0, W, H); } }   // nothing set: just you
      else {
        drawBackground(octx);
        livePose = smoothPose(livePose, poseOf(mask));
        if (fgPrompt && person && personAlpha > 0.003) {                     // the re-imagined you
          octx.globalAlpha = personAlpha;
          follow(octx, personPose, () => octx.drawImage(cutout(person, personMask), 0, 0));
          const k = Math.min(1, (performance.now() - personAt) / fade);
          if (k < 1) { octx.globalAlpha = (1 - k) * personAlpha; follow(octx, prevPose, () => octx.drawImage(prevCut, 0, 0)); }
          octx.globalAlpha = 1;
        } else if (bgImg && showReal && !fgPrompt) octx.drawImage(cutout(grab, mask), 0, 0);   // the real you, on the new background
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

  // ---------- server ----------
  const ready = [];
  async function connect() {
    try {
      const m = await (await fetch("/config", { cache: "no-store" })).json();
      if (m.width !== W || m.height !== H || (m.out_scale || 2) !== S) { W = m.width; H = m.height; S = m.out_scale || 2; sizeCanvases(); }
      serverPose = !!m.server_pose; parallax = m.parallax ?? parallax;
      stat.engine = m.engine; stat.references = m.references;
      if (lookSeen === null) { lookSeen = m.look; tuneSeen = m.tune; }
      stat.filter = m.filter || ""; stat.skip = m.skip_still;
      shapeMode = m.shape || "depth";
      online = true; ready.splice(0).forEach(f => f(m)); pump();
    } catch (e) { online = false; setTimeout(connect, 2000); }
  }
  const offline = () => { online = false; flying = 0; setTimeout(connect, 2000); };

  // the look is tuned live on /panel: when it changes, repaint the world and the avatar straight away
  let lookSeen = null, tuneSeen = null;
  setInterval(async () => {
    if (!online) return;
    try {
      const m = await (await fetch("/config", { cache: "no-store" })).json();
      if (tuneSeen !== null && m.tune !== tuneSeen) refresh();                       // any setting: a fresh avatar frame
      if (lookSeen !== null && m.look !== lookSeen && bgPrompt) setBackground(bgPrompt);   // the look: a fresh world too
      lookSeen = m.look; tuneSeen = m.tune; shapeMode = m.shape || "depth"; stat.filter = m.filter || ""; stat.skip = m.skip_still;
      serverPose = !!m.server_pose; parallax = m.parallax ?? parallax;
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

  let bgAsk = 0;
  async function setBackground(prompt, { keep = 0, fade = 600, fresh = false } = {}) {
    bgPrompt = prompt || null;
    if (!bgPrompt) { oldBg = null; bgImg = null; refresh(); return; }
    stat.note = "making background…";
    const ask = ++bgAsk;
    try {
      const q = `prompt=${encodeURIComponent(bgPrompt)}&keep=${(+keep).toFixed(2)}${fresh ? "&fresh=1" : ""}`;
      const res = await fetch("/background?" + q, { cache: "no-store" });
      if (!res.ok) throw new Error("status " + res.status);
      stat.bgMs = +res.headers.get("X-Gen-Ms") || 0;
      const img = await createImageBitmap(await res.blob());
      if (ask !== bgAsk) { img.close(); return; }          // a newer background was asked for meanwhile
      let depth = null;                                     // its depth, for the parallax (made on the server, once per world)
      const wid = res.headers.get("X-World");
      if (wid && px && parallax > 0) {
        try { const d = await fetch(`/world_depth?id=${wid}`, { cache: "no-store" }); if (d.status === 200) depth = await createImageBitmap(await d.blob()); } catch (e) {}
      }
      if (ask !== bgAsk) { img.close(); return; }
      oldBg = snapshotBg(); oldPair = bgImg ? { img: bgImg, depth: bgDepth } : null;
      bgImg = img; bgDepth = depth; bgAt = performance.now(); bgFade = Math.max(1, fade); refresh();
      stat.note = "";
    } catch (e) { stat.note = ""; offline(); }
  }
  // the world as it is on screen right now (mid-fade too), so a new fade starts from exactly what you see
  function snapshotBg() {
    if (!bgImg) return null;
    const c = mk(); drawBackground(c.getContext("2d")); return c;
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
    stat, setPerson, setBackground, setScene, refresh, camera, hold, setReal, setPersonAlpha, setControl, where, skinTone, nextCamera,
    whenReady: () => online ? Promise.resolve() : new Promise(r => ready.push(r)),
    get size() { return { W, H }; },
    reconnect: offline,
  };
}
