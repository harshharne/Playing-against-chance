// Whom: the home being built, in pencil on white paper. One drawing per household (keyed by the card's name),
// drawn stroke by stroke, then its colours washed in. Its own canvas over the live picture, faded in and out.
//
//   const house = createHouse(canvas)
//   house.show(ms)                 an empty plot: just the ground
//   await house.build(name, ms)    the household's home, built over ms
//   house.hide(ms) / house.hold(on) / house.reset()
//
// A drawing is a list of strokes in a box 1 wide, 0.62 high (y = 1 is the ground; x and y are in box widths/heights):
//   ["l", x1, y1, x2, y2]   ["p", [x, y, ...], closed]   ["r", x, y, w, h]   ["c", cx, cy, r]   ["a", cx, cy, r, from, to]
//   ["f", [x, y, ...], [r, g, b]]  a coloured fill, washed in after the lines around it

const PI = Math.PI;
const people = (xs, y, s = 1) => xs.flatMap(x => [["c", x, y, 0.014 * s], ["l", x, y + 0.016 * s, x, y + 0.07 * s]]);
const grid = (x0, y0, cols, rows, dx, dy, w, h) => Array.from({ length: cols * rows }, (_, i) => ["r", x0 + (i % cols) * dx, y0 + Math.floor(i / cols) * dy, w, h]);

const HOUSES = {
  "Landless farmers": [
    ["p", [0.12, 1, 0.12, 0.62, 0.42, 0.62, 0.42, 1]],
    ["f", [0.12, 1, 0.12, 0.62, 0.42, 0.62, 0.42, 1], [190, 130, 90]],
    ["p", [0.06, 0.64, 0.27, 0.36, 0.48, 0.64], true],
    ["f", [0.06, 0.64, 0.27, 0.36, 0.48, 0.64], [214, 180, 100]],
    ["l", 0.27, 0.38, 0.13, 0.62], ["l", 0.27, 0.38, 0.21, 0.63], ["l", 0.27, 0.38, 0.33, 0.63], ["l", 0.27, 0.38, 0.41, 0.62],
    ["p", [0.23, 1, 0.23, 0.78, 0.31, 0.78, 0.31, 1]],
    ["l", 0.52, 0.98, 1.08, 0.9], ["l", 0.54, 0.94, 1.08, 0.86], ["l", 0.56, 0.9, 1.08, 0.82], ["l", 0.58, 0.86, 1.08, 0.78],
    ["l", 0.5, 1, 0.5, 0.82], ["l", 0.5, 0.86, 0.58, 0.84],
    ["l", 0.97, 1, 0.97, 0.62], ["c", 0.97, 0.52, 0.1], ["f", [0.88, 0.52, 0.97, 0.42, 1.06, 0.52, 0.97, 0.62], [140, 190, 120]],
    ...people([0.46, 0.5, 0.54, 0.58, 0.62], 0.89, 0.8),
  ],
  "A shopkeeper's family": [
    ["r", 0.2, 0.3, 0.6, 0.7], ["l", 0.17, 0.3, 0.83, 0.3], ["l", 0.2, 0.62, 0.8, 0.62],
    ["r", 0.32, 0.21, 0.36, 0.07], ["f", [0.32, 0.21, 0.68, 0.21, 0.68, 0.28, 0.32, 0.28], [240, 200, 90]],
    ["r", 0.28, 0.38, 0.12, 0.14], ["r", 0.6, 0.38, 0.12, 0.14],
    ["p", [0.17, 0.62, 0.83, 0.62, 0.83, 0.69, 0.17, 0.69], true],
    ["f", [0.17, 0.62, 0.83, 0.62, 0.83, 0.69, 0.17, 0.69], [235, 120, 100]],
    ["l", 0.29, 0.62, 0.29, 0.69], ["l", 0.41, 0.62, 0.41, 0.69], ["l", 0.53, 0.62, 0.53, 0.69], ["l", 0.65, 0.62, 0.65, 0.69], ["l", 0.77, 0.62, 0.77, 0.69],
    ["r", 0.27, 0.72, 0.46, 0.28], ["r", 0.27, 0.87, 0.46, 0.06],
    ["c", 0.33, 0.83, 0.025], ["c", 0.4, 0.83, 0.025], ["c", 0.47, 0.83, 0.025], ["c", 0.6, 0.83, 0.025], ["c", 0.67, 0.83, 0.025],
    ["f", [0.3, 0.8, 0.7, 0.8, 0.7, 0.86, 0.3, 0.86], [200, 170, 120]],
    ...people([0.5], 0.8, 0.9),
  ],
  "Salaried, on loans": [
    ["r", 0.22, 0.06, 0.42, 0.94], ["l", 0.2, 0.06, 0.66, 0.06],
    ...grid(0.26, 0.12, 3, 6, 0.12, 0.135, 0.08, 0.085),
    ["f", [0.38, 0.525, 0.46, 0.525, 0.46, 0.61, 0.38, 0.61], [120, 170, 230]],
    ["r", 0.405, 0.535, 0.03, 0.065],
    ["p", [0.68, 0.97, 0.7, 0.88, 0.76, 0.83, 0.9, 0.83, 0.95, 0.89, 0.99, 0.91, 0.99, 0.97], true],
    ["f", [0.68, 0.97, 0.7, 0.88, 0.76, 0.83, 0.9, 0.83, 0.95, 0.89, 0.99, 0.91, 0.99, 0.97], [120, 160, 220]],
    ["c", 0.74, 0.975, 0.025], ["c", 0.93, 0.975, 0.025], ["l", 0.78, 0.84, 0.78, 0.89], ["l", 0.78, 0.89, 0.94, 0.89],
  ],
  "Devout and strict": [
    ["p", [0.25, 1, 0.25, 0.55, 0.7, 0.55, 0.7, 1]],
    ["f", [0.25, 1, 0.25, 0.55, 0.7, 0.55, 0.7, 1], [236, 222, 196]],
    ["p", [0.2, 0.57, 0.475, 0.35, 0.75, 0.57], true], ["f", [0.2, 0.57, 0.475, 0.35, 0.75, 0.57], [200, 120, 90]],
    ["l", 0.42, 1, 0.42, 0.8], ["a", 0.475, 0.8, 0.055, PI, 2 * PI], ["l", 0.53, 0.8, 0.53, 1],
    ["r", 0.3, 0.66, 0.07, 0.08], ["r", 0.58, 0.66, 0.07, 0.08],
    ["l", 0.475, 0.35, 0.475, 0.17], ["p", [0.475, 0.17, 0.57, 0.205, 0.475, 0.24], true], ["f", [0.475, 0.17, 0.57, 0.205, 0.475, 0.24], [240, 150, 60]],
    ["p", [0.78, 1, 0.78, 0.78, 0.9, 0.78, 0.9, 1]], ["a", 0.84, 0.78, 0.06, PI, 2 * PI],
    ["f", [0.78, 1, 0.78, 0.78, 0.9, 0.78, 0.9, 1], [245, 210, 150]],
    ["c", 0.84, 0.9, 0.013], ["p", [0.84, 0.885, 0.832, 0.87, 0.84, 0.85, 0.848, 0.87], true], ["f", [0.84, 0.885, 0.832, 0.87, 0.84, 0.85, 0.848, 0.87], [250, 170, 60]],
  ],
  "Artists, rent overdue": [
    ["r", 0.32, 0.12, 0.3, 0.88], ["l", 0.3, 0.12, 0.64, 0.12],
    ["r", 0.36, 0.2, 0.22, 0.2], ["f", [0.36, 0.2, 0.58, 0.2, 0.58, 0.4, 0.36, 0.4], [250, 205, 130]],
    ["l", 0.42, 0.39, 0.47, 0.25], ["l", 0.52, 0.39, 0.47, 0.25], ["r", 0.44, 0.26, 0.07, 0.06],
    ["c", 0.38, 0.195, 0.014], ["c", 0.56, 0.195, 0.014],
    ["r", 0.36, 0.5, 0.22, 0.2],
    ["l", 0.37, 0.56, 0.57, 0.56], ["l", 0.37, 0.62, 0.57, 0.62], ["l", 0.37, 0.68, 0.57, 0.68],
    ["f", [0.37, 0.51, 0.57, 0.51, 0.57, 0.69, 0.37, 0.69], [200, 120, 150]],
    ["r", 0.44, 0.8, 0.08, 0.2],
    ["c", 0.66, 0.83, 0.02], ["l", 0.66, 0.85, 0.66, 0.93], ["l", 0.66, 0.93, 0.645, 1], ["l", 0.66, 0.93, 0.675, 1], ["l", 0.66, 0.87, 0.6, 0.85],
  ],
  "Old money": [
    ["r", 0.1, 0.45, 0.8, 0.55], ["l", 0.07, 0.45, 0.93, 0.45],
    ["f", [0.1, 0.45, 0.9, 0.45, 0.9, 1, 0.1, 1], [232, 218, 192]],
    ["r", 0.18, 0.36, 0.04, 0.09], ["r", 0.78, 0.36, 0.04, 0.09],
    ["p", [0.34, 0.45, 0.5, 0.3, 0.66, 0.45], true], ["f", [0.34, 0.45, 0.5, 0.3, 0.66, 0.45], [212, 192, 160]],
    ["l", 0.38, 0.45, 0.38, 0.9], ["l", 0.45, 0.45, 0.45, 0.9], ["l", 0.55, 0.45, 0.55, 0.9], ["l", 0.62, 0.45, 0.62, 0.9],
    ["l", 0.33, 0.9, 0.67, 0.9], ["l", 0.3, 0.95, 0.7, 0.95],
    ...grid(0.14, 0.52, 2, 2, 0.08, 0.2, 0.06, 0.11), ...grid(0.72, 0.52, 2, 2, 0.08, 0.2, 0.06, 0.11),
    ["l", 0.01, 1, 0.01, 0.75], ["c", 0.01, 0.66, 0.08], ["f", [-0.07, 0.66, 0.01, 0.58, 0.09, 0.66, 0.01, 0.74], [140, 190, 120]],
    ["l", 0.99, 1, 0.99, 0.75], ["c", 0.99, 0.66, 0.08], ["f", [0.91, 0.66, 0.99, 0.58, 1.07, 0.66, 0.99, 0.74], [140, 190, 120]],
  ],
  "A politician's family": [
    ["r", 0.2, 0.37, 0.6, 0.48], ["p", [0.15, 0.38, 0.5, 0.18, 0.85, 0.38], true],
    ["f", [0.2, 0.37, 0.8, 0.37, 0.8, 0.85, 0.2, 0.85], [236, 228, 214]],
    ["r", 0.25, 0.45, 0.1, 0.14], ["c", 0.3, 0.5, 0.025], ["f", [0.25, 0.45, 0.35, 0.45, 0.35, 0.59, 0.25, 0.59], [240, 200, 120]],
    ["r", 0.65, 0.45, 0.1, 0.14], ["c", 0.7, 0.5, 0.025], ["f", [0.65, 0.45, 0.75, 0.45, 0.75, 0.59, 0.65, 0.59], [240, 200, 120]],
    ["a", 0.3, 0.4, 0.05, 0, PI], ["a", 0.4, 0.4, 0.05, 0, PI], ["a", 0.5, 0.4, 0.05, 0, PI], ["a", 0.6, 0.4, 0.05, 0, PI], ["a", 0.7, 0.4, 0.05, 0, PI],
    ["r", 0.42, 0.68, 0.16, 0.17], ["l", 0.46, 0.68, 0.46, 0.85], ["l", 0.5, 0.68, 0.5, 0.85], ["l", 0.54, 0.68, 0.54, 0.85],
    ["l", 0.15, 0.38, 0.15, 0.16], ["p", [0.15, 0.16, 0.24, 0.19, 0.15, 0.22], true], ["f", [0.15, 0.16, 0.24, 0.19, 0.15, 0.22], [80, 170, 100]],
    ["l", 0.85, 0.38, 0.85, 0.16], ["p", [0.85, 0.16, 0.94, 0.19, 0.85, 0.22], true], ["f", [0.85, 0.16, 0.94, 0.19, 0.85, 0.22], [240, 150, 60]],
    ...people([0.06, 0.12, 0.18, 0.24, 0.3, 0.36, 0.64, 0.7, 0.76, 0.82, 0.88, 0.94], 0.91),
    ["r", 0.1, 0.86, 0.045, 0.03], ["c", 0.122, 0.875, 0.009], ["r", 0.86, 0.86, 0.045, 0.03], ["c", 0.882, 0.875, 0.009],
  ],
};

export function createHouse(canvas) {
  const g = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1, BW = 0, BH = 0, X0 = 0, Y0 = 0, paperC = null;
  let running = false, held = false, last = 0, strokes = [], total = 0, done = 0, speed = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (w === W && h === H && paperC) return;
    W = canvas.width = w; H = canvas.height = h;
    BW = Math.min(W * 0.5, H * 0.52 / 0.62); BH = BW * 0.62;
    X0 = (W - BW) / 2; Y0 = H * 0.64 - BH;                     // the ground sits above the narrative box and the cards
    paperC = document.createElement("canvas"); paperC.width = W; paperC.height = H;
    const p = paperC.getContext("2d");
    p.fillStyle = "#fff"; p.fillRect(0, 0, W, H);
    let s = 13; const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < (W * H) / 300; i++) { p.fillStyle = `rgba(120,110,100,${0.02 + rnd() * 0.03})`; p.fillRect(rnd() * W, rnd() * H, 1 + rnd() * dpr, 1 + rnd() * dpr); }
  }
  const X = (x) => X0 + x * BW, Y = (y) => Y0 + y * BH;

  // every stroke as a list of points (in box units), so any stroke can be drawn part-way
  function pointsOf(s) {
    const [k] = s;
    if (k === "l") return [[s[1], s[2]], [s[3], s[4]]];
    if (k === "r") { const [, x, y, w, h] = s; return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]; }
    if (k === "p" || k === "f") { const a = s[1], pts = []; for (let i = 0; i < a.length; i += 2) pts.push([a[i], a[i + 1]]); if (s[2] === true) pts.push(pts[0]); return pts; }
    if (k === "c" || k === "a") {
      const [, cx, cy, r] = s, a0 = k === "a" ? s[4] : 0, a1 = k === "a" ? s[5] : 2 * PI, n = 28, pts = [];
      for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * (BW / BH)]); }
      return pts;
    }
    return [];
  }
  const lenOf = (pts) => pts.reduce((L, p, i) => i ? L + Math.hypot((p[0] - pts[i - 1][0]) * BW, (p[1] - pts[i - 1][1]) * BH) : 0, 0);

  function plan(list) {
    resize();
    strokes = list.map(s => {
      const pts = pointsOf(s);
      return { s, pts, len: s[0] === "f" ? BW * 0.15 : Math.max(1, lenOf(pts)) };   // a fill takes a short moment to wash in
    });
    total = strokes.reduce((a, b) => a + b.len, 0); done = 0;
  }

  function line(pts, upto) {                                     // a pencil line, drawn up to a length, twice, slightly off
    for (const [w, a, o] of [[1.6, 0.85, 0], [0.8, 0.3, 0.8]]) {
      g.strokeStyle = `rgba(70,60,52,${a})`; g.lineWidth = w * dpr; g.lineCap = "round"; g.lineJoin = "round";
      g.beginPath(); let L = 0;
      g.moveTo(X(pts[0][0]) + o * dpr, Y(pts[0][1]) + o * dpr);
      for (let i = 1; i < pts.length; i++) {
        const sx = (pts[i][0] - pts[i - 1][0]) * BW, sy = (pts[i][1] - pts[i - 1][1]) * BH, seg = Math.hypot(sx, sy);
        if (L + seg >= upto) { const k = (upto - L) / Math.max(1e-6, seg); g.lineTo(X(pts[i - 1][0]) + sx * k + o * dpr, Y(pts[i - 1][1]) + sy * k + o * dpr); break; }
        g.lineTo(X(pts[i][0]) + o * dpr, Y(pts[i][1]) + o * dpr); L += seg;
      }
      g.stroke();
    }
  }
  function fill(pts, rgb, k) {
    g.save(); g.globalCompositeOperation = "multiply";
    g.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.5 * k})`;
    g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))); g.closePath(); g.fill();
    g.restore();
  }

  function frame(now) {
    if (!running) return;
    resize();
    const dt = (now - (last || now)) / 1000; last = now;          // real time, so a slow frame rate doesn't slow the build
    if (!held && speed > 0) done = Math.min(total, done + speed * Math.min(0.5, dt));
    g.drawImage(paperC, 0, 0);
    line([[-0.2, 1], [1.2, 1]], Infinity);                         // the ground
    let L = 0;
    for (const st of strokes) {                                    // fills under the lines, so draw them first
      if (st.s[0] === "f" && done > L) fill(st.pts, st.s[2], Math.min(1, (done - L) / st.len));
      L += st.len;
    }
    L = 0;
    for (const st of strokes) {
      if (st.s[0] !== "f" && done > L) line(st.pts, done - L);
      L += st.len;
      if (L > done) break;
    }
    requestAnimationFrame(frame);
  }

  return {
    names: Object.keys(HOUSES),
    show(ms = 1500) {
      plan([]); speed = 0;
      canvas.style.transition = `opacity ${ms}ms ease`;
      if (!running) { running = true; last = 0; requestAnimationFrame(frame); }
      requestAnimationFrame(() => { canvas.style.opacity = "1"; });
    },
    hide(ms = 2000) {
      canvas.style.transition = `opacity ${ms}ms ease`; canvas.style.opacity = "0";
      setTimeout(() => { if (canvas.style.opacity === "0") running = false; }, ms + 100);
    },
    hold(on) { held = !!on; },
    build(name, ms = 5000) {
      plan(HOUSES[name] || HOUSES["Salaried, on loans"]);
      speed = total / Math.max(0.5, ms / 1000);
      return new Promise(res => { const tick = () => (done >= total ? res() : setTimeout(tick, 100)); tick(); });
    },
    reset() { plan([]); speed = 0; },
  };
}
