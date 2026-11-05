// The birth: an egg and the sperm around it, drawn like coloured pencil on kraft paper.
// Its own canvas laid over the live picture (sharp at any screen size), faded in and out, so the world and the
// baby avatar are already painting underneath when it fades away: no hard cut.
//
//   const birth = createBirth(canvas)
//   birth.show(ms) / birth.hide(ms)      fade in / out
//   birth.ready(on)                      the sperm get restless while a throw is awaited
//   await birth.attempt(hit)             after a throw: hit = one reaches the egg; miss = a surge, and none make it
//   await birth.win()                    chance's override: one makes it anyway
//   birth.hold(on)                       everything holds still (the die is rolling)
//   birth.reset()                        a new life

export function createBirth(canvas) {
  const g = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1, R = 0, cx = 0, cy = 0;
  let paper = null, eggArt = null;                      // pre-drawn layers (redrawn on resize)
  let running = false, held = false, t = 0, last = 0;
  let sperm = [], restless = 0, restlessTo = 0, glow = 0, membrane = 0, fade = 1, spark = 0, spark_x = 0, spark_y = 0;

  // ---------- random, but the same picture every life (seeded) ----------
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  function makeSperm() {
    seed = 11;
    const n = 17;
    sperm = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.28 - Math.PI / 2;
      return {
        a, d0: 1.95 + rnd() * 0.45,                     // resting distance, in egg radii: well away from the egg
        ph: rnd() * 6.28, sp: 0.7 + rnd() * 0.6,         // tail wave phase and speed
        len: 1.5 + rnd() * 0.7, curl: (rnd() - 0.5) * 0.9,   // tail length, and a lazy bend in it
        size: 0.85 + rnd() * 0.3,
        off: 0, alpha: 1, into: 0,                       // animated: pulled in, faded, swallowed
      };
    });
  }

  // ---------- sizing ----------
  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (w === W && h === H) return;
    W = canvas.width = w; H = canvas.height = h;
    R = Math.min(W, H) * 0.2; cx = W / 2; cy = H * 0.48;
    paper = drawPaper(); eggArt = drawEgg();
  }
  const layer = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

  // white paper: a faint grain, so the pencil still sits on something
  function drawPaper() {
    const c = layer(W, H), p = c.getContext("2d");
    p.fillStyle = "#ffffff"; p.fillRect(0, 0, W, H);
    seed = 3;
    for (let i = 0; i < (W * H) / 260; i++) {
      const x = rnd() * W, y = rnd() * H, dark = rnd() < 0.5;
      p.fillStyle = dark ? `rgba(120,110,100,${0.02 + rnd() * 0.03})` : `rgba(255,255,255,0)`;
      p.fillRect(x, y, 1 + rnd() * 1.6 * dpr, 1 + rnd() * 1.6 * dpr);
    }
    p.lineWidth = 0.6 * dpr;
    for (let i = 0; i < (W * H) / 9000; i++) {         // fibres
      const x = rnd() * W, y = rnd() * H, l = (6 + rnd() * 16) * dpr, a = rnd() * 6.28;
      p.strokeStyle = "rgba(150,140,130,0.05)";
      p.beginPath(); p.moveTo(x, y); p.quadraticCurveTo(x + Math.cos(a + 0.6) * l / 2, y + Math.sin(a + 0.6) * l / 2, x + Math.cos(a) * l, y + Math.sin(a) * l); p.stroke();
    }
    const v = p.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.035)");
    p.fillStyle = v; p.fillRect(0, 0, W, H);
    return c;
  }

  // coloured-pencil shading: lots of short strokes, clipped to a circle
  function hatch(p, x, y, r, colours, density, len, angle = 1.05) {
    p.save(); p.beginPath(); p.arc(x, y, r, 0, 7); p.clip();
    p.lineCap = "round";
    for (let i = 0; i < density; i++) {
      const u = rnd() * 2 - 1, v = rnd() * 2 - 1;
      if (u * u + v * v > 1) continue;
      const px = x + u * r, py = y + v * r, l = (len * (0.5 + rnd())) * dpr, a = angle + (rnd() - 0.5) * 0.35;
      p.strokeStyle = colours[(rnd() * colours.length) | 0];
      p.lineWidth = (0.6 + rnd() * 0.8) * dpr;
      p.beginPath(); p.moveTo(px - Math.cos(a) * l / 2, py - Math.sin(a) * l / 2); p.lineTo(px + Math.cos(a) * l / 2, py + Math.sin(a) * l / 2); p.stroke();
    }
    p.restore();
  }

  // the egg: a glossy, iridescent sphere with the nucleus set a little high
  function drawEgg() {
    const s = Math.ceil(R * 3.2), c = layer(s, s), p = c.getContext("2d"), x = s / 2, y = s / 2;
    seed = 5;
    // the shadow it casts on the paper
    p.save(); p.filter = `blur(${R * 0.12}px)`; p.fillStyle = "rgba(160,90,90,0.16)";
    p.beginPath(); p.ellipse(x + R * 0.06, y + R * 0.12, R * 1.0, R * 0.98, 0, 0, 7); p.fill(); p.restore();
    // body
    const body = p.createRadialGradient(x - R * 0.3, y - R * 0.35, R * 0.1, x, y, R);
    body.addColorStop(0, "#fff4ec"); body.addColorStop(0.45, "#f9cfcc"); body.addColorStop(0.8, "#f3a99a"); body.addColorStop(1, "#ee9481");
    p.fillStyle = body; p.beginPath(); p.arc(x, y, R, 0, 7); p.fill();
    // the iridescent rim: pink, orange, gold, mint, sky, violet
    p.save(); p.beginPath(); p.arc(x, y, R, 0, 7); p.clip();
    const rim = p.createConicGradient ? p.createConicGradient(-0.6, x, y) : null;
    if (rim) {
      [["#ff86a8", 0], ["#ff9a5c", 0.18], ["#ffc46a", 0.32], ["#ff9f8a", 0.45], ["#8fc9ee", 0.58], ["#a58ae6", 0.68], ["#ff86a8", 0.82], ["#ff86a8", 1]]
        .forEach(([col, k]) => rim.addColorStop(k, col));
      p.filter = `blur(${R * 0.07}px)`; p.globalAlpha = 0.42; p.strokeStyle = rim; p.lineWidth = R * 0.22;
      p.beginPath(); p.arc(x, y, R * 0.99, 0, 7); p.stroke();
      p.globalAlpha = 0.2; p.lineWidth = R * 0.45; p.beginPath(); p.arc(x, y, R * 1.1, 0, 7); p.stroke();
      p.filter = "none"; p.globalAlpha = 1;
    }
    p.restore();
    // pencil texture over it
    hatch(p, x, y, R, ["rgba(255,255,255,0.10)", "rgba(240,120,130,0.08)", "rgba(255,170,120,0.08)", "rgba(150,150,240,0.05)"], R * 30, 5);
    hatch(p, x, y, R, ["rgba(255,255,255,0.07)", "rgba(235,110,120,0.06)"], R * 18, 5, -0.5);
    // the nucleus, shifted up
    const nx = x, ny = y - R * 0.16, nr = R * 0.27;
    p.save(); p.filter = `blur(${R * 0.04}px)`; p.fillStyle = "rgba(240,110,105,0.32)"; p.beginPath(); p.arc(nx, ny, nr * 1.55, 0, 7); p.fill(); p.restore();
    const nuc = p.createRadialGradient(nx - nr * 0.3, ny - nr * 0.35, nr * 0.1, nx, ny, nr);
    nuc.addColorStop(0, "#ff8f84"); nuc.addColorStop(0.7, "#ef5f5d"); nuc.addColorStop(1, "#d94b54");
    p.fillStyle = nuc; p.beginPath(); p.arc(nx, ny, nr, 0, 7); p.fill();
    hatch(p, nx, ny, nr, ["rgba(200,40,60,0.22)", "rgba(255,150,140,0.2)"], R * 6, 6);
    p.strokeStyle = "rgba(190,50,65,0.45)"; p.lineWidth = 1.2 * dpr; p.beginPath(); p.arc(nx, ny, nr, 0, 7); p.stroke();
    p.fillStyle = "rgba(255,225,215,0.55)"; p.beginPath(); p.ellipse(nx - nr * 0.38, ny - nr * 0.42, nr * 0.22, nr * 0.13, -0.6, 0, 7); p.fill();
    // highlights: a big soft one, a few sharp ones, a reflected band low on the right
    p.save(); p.filter = `blur(${R * 0.07}px)`;
    p.fillStyle = "rgba(255,255,255,0.75)"; p.beginPath(); p.ellipse(x - R * 0.42, y - R * 0.5, R * 0.24, R * 0.13, -0.7, 0, 7); p.fill();
    p.fillStyle = "rgba(255,255,255,0.45)"; p.beginPath(); p.ellipse(x + R * 0.38, y + R * 0.42, R * 0.32, R * 0.09, -0.75, 0, 7); p.fill();
    p.restore();
    p.fillStyle = "rgba(255,255,255,0.95)";
    for (const [dx, dy, r] of [[-0.3, -0.62, 0.05], [0.18, -0.7, 0.03], [0.62, 0.05, 0.025]]) { p.beginPath(); p.arc(x + R * dx, y + R * dy, R * r, 0, 7); p.fill(); }
    // a pencil outline, drawn twice, slightly off
    p.strokeStyle = "rgba(196,92,104,0.55)"; p.lineWidth = 1.3 * dpr; p.beginPath(); p.arc(x, y, R, 0, 7); p.stroke();
    p.strokeStyle = "rgba(150,90,170,0.25)"; p.lineWidth = 0.8 * dpr; p.beginPath(); p.arc(x + 0.8 * dpr, y + 0.6 * dpr, R * 1.004, 0, 7); p.stroke();
    return c;
  }

  // ---------- one sperm: tail first (behind), then the head pointing in ----------
  function drawSperm(s, k) {
    const time = t * s.sp * (1 + restless * 1.6);
    const d = R * (s.d0 - s.off) + Math.sin(t * 0.6 + s.ph) * R * 0.05 * (1 - s.into);
    const a = s.a + Math.sin(t * 0.25 + s.ph) * 0.04;
    const ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux;  // out from the egg, and across
    const hx = cx + ux * d, hy = cy + uy * d;                  // the head's tip-ish centre
    const sz = R * 0.17 * s.size * (1 - s.into * 0.7);
    g.globalAlpha = s.alpha * fade;
    // tail: a travelling wave that grows towards the end, with a lazy curl, tapering
    const L = R * s.len, N = 46, pts = [];
    for (let j = 0; j <= N; j++) {
      const q = j / N, along = sz * 1.2 + q * L;
      const wave = Math.sin(q * 9 - time * 7 + s.ph) * R * 0.06 * Math.min(1, q * 2.2) + s.curl * q * q * R * 0.6;
      pts.push([hx + ux * along + px * wave, hy + uy * along + py * wave]);
    }
    g.lineCap = "round"; g.lineJoin = "round";
    for (const [w, al, ox] of [[2.2, 0.85, 0], [1.1, 0.35, 0.9]]) {   // the line, then a fainter pencil double
      for (let seg = 0; seg < 3; seg++) {
        g.strokeStyle = `rgba(226,86,108,${al})`; g.lineWidth = w * dpr * (1 - seg * 0.28);
        g.beginPath();
        const a0 = Math.floor((seg / 3) * N), a1 = Math.floor(((seg + 1) / 3) * N);
        for (let j = a0; j <= a1; j++) { const [x, y] = pts[j]; j === a0 ? g.moveTo(x + ox * dpr, y + ox * dpr) : g.lineTo(x + ox * dpr, y + ox * dpr); }
        g.stroke();
      }
    }
    // midpiece
    g.strokeStyle = "rgba(232,120,120,0.9)"; g.lineWidth = sz * 0.32;
    g.beginPath(); g.moveTo(hx + ux * sz * 0.5, hy + uy * sz * 0.5); g.lineTo(hx + ux * sz * 1.35, hy + uy * sz * 1.35); g.stroke();
    // head: an oval with soft shading and a highlight, pointing at the egg
    g.save(); g.translate(hx, hy); g.rotate(a);
    const hg = g.createRadialGradient(-sz * 0.25, -sz * 0.2, sz * 0.05, 0, 0, sz);
    hg.addColorStop(0, "#ffd2c6"); hg.addColorStop(0.6, "#f79a8c"); hg.addColorStop(1, "#e7747a");
    g.fillStyle = hg; g.beginPath(); g.ellipse(0, 0, sz * 0.62, sz * 0.42, 0, 0, 7); g.fill();
    g.strokeStyle = "rgba(190,70,85,0.6)"; g.lineWidth = 0.9 * dpr; g.stroke();
    g.fillStyle = "rgba(255,255,255,0.7)"; g.beginPath(); g.ellipse(-sz * 0.22, -sz * 0.16, sz * 0.16, sz * 0.08, -0.3, 0, 7); g.fill();
    g.restore();
    g.globalAlpha = 1;
  }

  // ---------- the frame ----------
  function frame(now) {
    if (!running) return;
    resize();
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (!held) { t += dt; restless += (restlessTo - restless) * Math.min(1, dt * 2); }
    g.clearRect(0, 0, W, H);
    g.drawImage(paper, 0, 0);
    // behind the egg: the sperm on the far side are drawn first, the egg over them
    sperm.forEach((s, k) => { if (!s.top) drawSperm(s, k); });
    const breathe = 1 + Math.sin(t * 0.8) * 0.006 + glow * 0.02;
    const s = eggArt.width * breathe;
    g.drawImage(eggArt, cx - s / 2, cy - s / 2, s, s);
    if (membrane > 0) {                                        // fertilised: a fine new membrane lifts off the egg
      g.strokeStyle = `rgba(255,250,240,${0.55 * Math.min(1, membrane)})`; g.lineWidth = 1.4 * dpr;
      g.beginPath(); g.arc(cx, cy, R * (1.02 + 0.08 * Math.min(1, membrane)), 0, 7); g.stroke();
    }
    sperm.forEach((s, k) => { if (s.top) drawSperm(s, k); });   // the one that makes it: drawn over the egg, so you see it arrive
    if (spark > 0.01) {                                        // the moment it touches: a small flash at the contact point
      const sp = g.createRadialGradient(spark_x, spark_y, 0, spark_x, spark_y, R * 0.35);
      sp.addColorStop(0, `rgba(255,255,255,${spark})`); sp.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = sp; g.fillRect(spark_x - R * 0.4, spark_y - R * 0.4, R * 0.8, R * 0.8);
      if (!held) spark *= 1 - dt * 1.2;
    }
    if (glow > 0.01) {
      const gl = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.8);
      gl.addColorStop(0, `rgba(255,245,230,${0.35 * glow})`); gl.addColorStop(1, "rgba(255,245,230,0)");
      g.fillStyle = gl; g.fillRect(cx - R * 2, cy - R * 2, R * 4, R * 4);
      if (!held) glow *= 1 - dt * 0.5;
    }
    requestAnimationFrame(frame);
  }

  // ---------- moves ----------
  const ease = (k) => k * k * (3 - 2 * k);
  function tween(ms, step) {                                   // runs step(k) from 0 to 1 over ms (pauses while held)
    return new Promise(res => {
      let k = 0, prev = performance.now();
      const tick = (now) => {
        if (!held) k += (now - prev) / ms;
        prev = now;
        step(Math.min(1, ease(Math.min(1, k))));
        if (k >= 1) res(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  async function surge() {                                     // they all rush in... and none get there
    const from = sperm.map(s => s.off);
    await tween(1300, k => sperm.forEach((s, i) => { s.off = from[i] + (s.d0 - 1.35 - from[i]) * 0.55 * k; }));
    await tween(1500, k => sperm.forEach((s, i) => { const top = from[i] + (s.d0 - 1.35 - from[i]) * 0.55; s.off = top + (0 - top) * k; }));
  }
  async function win() {                                       // one makes it: it swims in, the egg takes it
    const off = (s) => Math.abs(Math.atan2(Math.sin(s.a + 0.75), Math.cos(s.a + 0.75)));   // the one up and to the right
    const w = sperm.reduce((best, s, i) => (off(s) < off(sperm[best]) ? i : best), 0);
    const W0 = sperm[w];
    W0.top = true;
    await tween(2400, k => sperm.forEach((s, i) => {
      if (i === w) s.off = (s.d0 - 1.02) * k;
      else { s.off = -0.25 * k; s.alpha = 1 - 0.55 * k; }
    }));
    glow = 1; spark = 1;
    spark_x = cx + Math.cos(W0.a) * R * 1.0; spark_y = cy + Math.sin(W0.a) * R * 1.0;
    await tween(1400, k => { W0.into = k; W0.alpha = 1 - k; membrane = k; });
  }

  makeSperm();
  return {
    show(ms = 1500) {
      canvas.style.transition = `opacity ${ms}ms ease`;
      if (!running) { running = true; last = 0; requestAnimationFrame(frame); }
      requestAnimationFrame(() => { canvas.style.opacity = "1"; });
    },
    hide(ms = 2500) {
      canvas.style.transition = `opacity ${ms}ms ease`; canvas.style.opacity = "0";
      setTimeout(() => { if (canvas.style.opacity === "0") running = false; }, ms + 100);
    },
    ready(on) { restlessTo = on ? 1 : 0; },
    hold(on) { held = !!on; },
    attempt(hit) { restlessTo = 0; return hit ? win() : surge(); },
    win,
    reset() { makeSperm(); glow = 0; membrane = 0; restless = restlessTo = 0; t = 0; },
  };
}
