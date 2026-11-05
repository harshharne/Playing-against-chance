// Body: the baby. One painted portrait (SDXL on the RTX), then repainted lightly as each trait emerges; animated here
// in the browser: it breathes, blinks, its eyes follow you, its hands and blanket move a little.
// (The eyes are found on the painting with MediaPipe's face landmarks; if none are found, it still breathes and moves.)
// Its own transparent canvas over the painted world, with soft oval edges, faded in and out.
//
//   const baby = createBaby(canvas, live)    live.where() -> where you are in the camera (0..1), for the eyes
//   await baby.show(bitmap, ms) / await baby.update(bitmap, ms) / baby.alpha(a) / baby.hide(ms) / baby.hold(on)

export function createBaby(canvas, live) {
  const g = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1, running = false, held = false, t = 0, last = 0;
  let cur = null, prev = null, fadeAt = 0, fadeMs = 1, alpha = 1;
  let eyes = null, blinkAt = 3, blinkK = 0, gaze = [0, 0];
  let lm = null, lmLoading = null;
  const work = document.createElement("canvas"), wg = work.getContext("2d");
  const oval = document.createElement("canvas");

  async function landmarker() {
    if (lm || lmLoading) return lmLoading;
    lmLoading = (async () => {
      try {
        const v = "0.10.14";
        const { FilesetResolver, FaceLandmarker } = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${v}/vision_bundle.mjs`);
        const files = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${v}/wasm`);
        lm = await FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task", delegate: "GPU" },
          runningMode: "IMAGE", numFaces: 1,
        });
      } catch (e) { console.warn("[baby] no face landmarks:", e); lm = null; }
      return lm;
    })();
    return lmLoading;
  }

  // the eyes on the painting: centre, size, and the skin colour just above (for the eyelid)
  async function findEyes(bmp) {
    eyes = null;
    const L = await landmarker();
    if (!L) return;
    try {
      const res = L.detect(bmp), f = res.faceLandmarks && res.faceLandmarks[0];
      if (!f) return;
      const n = bmp.width, m = bmp.height;
      const eye = (a, b, top, bot) => {
        const x1 = f[a].x * n, x2 = f[b].x * n, yt = f[top].y * m, yb = f[bot].y * m;
        return { cx: (x1 + x2) / 2, cy: (yt + yb) / 2, rx: Math.abs(x2 - x1) / 2 * 1.15, ry: Math.max(2, Math.abs(yb - yt) / 2 * 1.4) };
      };
      eyes = [eye(33, 133, 159, 145), eye(362, 263, 386, 374)];
      const s = document.createElement("canvas"); s.width = n; s.height = m;
      const sg = s.getContext("2d"); sg.drawImage(bmp, 0, 0);
      for (const e of eyes) {
        const d = sg.getImageData(Math.round(e.cx - e.rx * 0.5), Math.max(0, Math.round(e.cy - e.ry * 2.6)), Math.max(1, Math.round(e.rx)), Math.max(1, Math.round(e.ry))).data;
        let r = 0, gg = 0, b = 0, k = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; k++; }
        e.skin = `rgb(${Math.round(r / k)},${Math.round(gg / k)},${Math.round(b / k)})`;
      }
    } catch (e) { eyes = null; }
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (w !== W || h !== H) { W = canvas.width = w; H = canvas.height = h; }
  }

  // one frame of the portrait itself, animated, into `work`
  function animate(img) {
    const n = img.width, m = img.height;
    if (work.width !== n || work.height !== m) { work.width = n; work.height = m; }
    wg.clearRect(0, 0, n, m);
    wg.drawImage(img, 0, 0);
    // the hands and the blanket: the lower part sways gently, more towards the bottom
    const top = Math.round(m * 0.66), amp = n * 0.006;
    for (let y = top; y < m; y += 4) {
      const k = (y - top) / (m - top), dx = Math.sin(t * 1.4 + y * 0.025) * amp * k + Math.sin(t * 0.7) * amp * 0.6 * k;
      wg.drawImage(img, 0, y, n, 4, dx, y, n, 4);
    }
    if (!eyes) return;
    for (const e of eyes) {
      // the eyes follow you: the inside of each eye shifts a little towards where you are
      wg.save(); wg.beginPath(); wg.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, 7); wg.clip();
      wg.drawImage(img, gaze[0] * e.rx * 0.35, gaze[1] * e.ry * 0.3);
      wg.restore();
      // a blink: the lid comes down, with a lash line at its edge
      if (blinkK > 0.02) {
        wg.save(); wg.beginPath(); wg.ellipse(e.cx, e.cy, e.rx * 1.08, e.ry * 1.15, 0, 0, 7); wg.clip();
        const lidY = e.cy - e.ry * 1.2 + e.ry * 2.4 * blinkK;
        wg.fillStyle = e.skin; wg.fillRect(e.cx - e.rx * 1.2, e.cy - e.ry * 1.4, e.rx * 2.4, lidY - (e.cy - e.ry * 1.4));
        wg.restore();
        wg.strokeStyle = "rgba(60,40,35,0.6)"; wg.lineWidth = Math.max(1, e.ry * 0.25);
        wg.beginPath(); wg.ellipse(e.cx, Math.min(e.cy + e.ry * 0.9, lidY), e.rx, e.ry * 0.25, 0, 0, Math.PI); wg.stroke();
      }
    }
  }

  function frame(now) {
    if (!running) return;
    resize();
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (!held) {
      t += dt;
      blinkAt -= dt;                                            // a blink every few seconds, ~0.2 s long
      if (blinkAt < 0) { blinkK = Math.min(1, blinkK + dt * 11); if (blinkAt < -0.18) { blinkAt = 2.5 + Math.random() * 3.5; } }
      else blinkK = Math.max(0, blinkK - dt * 9);
      const p = live && live.where ? live.where() : null;      // your position in the camera -> where the baby looks
      const want = p ? [(p.x - 0.5) * 2, (p.y - 0.45) * 1.5] : [Math.sin(t * 0.3) * 0.4, 0];
      gaze = [gaze[0] + (Math.max(-1, Math.min(1, want[0])) - gaze[0]) * dt * 3, gaze[1] + (Math.max(-1, Math.min(1, want[1])) - gaze[1]) * dt * 3];
    }
    g.clearRect(0, 0, W, H);
    const k = Math.min(1, (now - fadeAt) / fadeMs), e = k * k * (3 - 2 * k);
    const size = Math.min(H * 0.62, W * 0.5), breathe = 1 + Math.sin(t * 1.6) * 0.008;
    const x = W / 2, y = H * 0.4;
    for (const [img, a] of [[prev, 1 - e], [cur, prev ? e : 1]]) {
      if (!img || a <= 0.001) continue;
      animate(img);
      if (oval.width !== work.width) { oval.width = work.width; oval.height = work.height; }
      const o = oval.getContext("2d");                          // soft oval edges, so it sits in the painted room
      o.globalCompositeOperation = "source-over"; o.clearRect(0, 0, oval.width, oval.height); o.drawImage(work, 0, 0);
      o.globalCompositeOperation = "destination-in";
      const rg = o.createRadialGradient(oval.width / 2, oval.height * 0.46, oval.width * 0.25, oval.width / 2, oval.height * 0.5, oval.width * 0.52);
      rg.addColorStop(0, "rgba(0,0,0,1)"); rg.addColorStop(0.75, "rgba(0,0,0,0.85)"); rg.addColorStop(1, "rgba(0,0,0,0)");
      o.fillStyle = rg; o.fillRect(0, 0, oval.width, oval.height);
      g.globalAlpha = a * alpha;
      const s = size * breathe;
      g.drawImage(oval, x - s / 2, y - s / 2 - (breathe - 1) * s * 0.5, s, s);
    }
    g.globalAlpha = 1;
    if (k >= 1 && prev) prev = null;
    requestAnimationFrame(frame);
  }

  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  return {
    async show(bmp, ms = 1500) {
      prev = null; cur = bmp; fadeAt = performance.now(); fadeMs = 1; alpha = 1;
      await findEyes(bmp);
      canvas.style.transition = `opacity ${ms}ms ease`;
      if (!running) { running = true; last = 0; requestAnimationFrame(frame); }
      requestAnimationFrame(() => { canvas.style.opacity = "1"; });
      await wait(ms);
    },
    async update(bmp, ms = 1200) {                              // a trait emerging: crossfade to the repainted baby
      prev = cur; cur = bmp; fadeAt = performance.now(); fadeMs = ms;
      findEyes(bmp);
      await wait(ms);
    },
    alpha(a) { alpha = Math.max(0, Math.min(1, a)); },
    hide(ms = 2000) {
      canvas.style.transition = `opacity ${ms}ms ease`; canvas.style.opacity = "0";
      setTimeout(() => { if (canvas.style.opacity === "0") { running = false; cur = prev = null; } }, ms + 100);
    },
    hold(on) { held = !!on; },
    preload() { landmarker(); },
  };
}
