// Where: a world map in pencil on white paper, its countries grouped into the 8 regions on the cards.
// Hover a card and its region warms; the drawn region fills in and glows; an allotted one is found by a light
// that runs across the regions and stops on it. Its own canvas over the live picture, faded in and out.
//
//   const map = createWorldMap(canvas)        map.load() fetches worldmap.json (made from Natural Earth via world-atlas)
//   map.show(ms) / map.hide(ms) / map.hold(on) / map.reset()
//   map.hover(name | null)                    a card's region, while the player hovers it
//   await map.reveal(name, run)               run = true: the light runs across the regions first (an allotment)

const TINT = {
  "Sub-Saharan Africa": [242, 166, 90], "South Asia": [240, 127, 127], "East Asia": [229, 155, 209],
  "Southeast Asia and the Pacific": [124, 198, 214], "Middle East and North Africa": [232, 194, 106],
  "Latin America": [155, 209, 140], "Europe": [143, 168, 232], "North America": [183, 155, 232],
};

export function createWorldMap(canvas) {
  const g = canvas.getContext("2d");
  let data = null, regions = {}, names = [];
  let W = 0, H = 0, dpr = 1, sc = 1, ox = 0, oy = 0, base = null;
  let running = false, held = false, t = 0, last = 0;
  let hoverName = null, hoverK = {}, chosen = null, chosenK = 0, runAt = -1, glow = 0;

  async function load() {
    if (data) return;
    data = await (await fetch("worldmap.json", { cache: "force-cache" })).json();
    names = Object.keys(data.regions);
    for (const n of names) {
      const p = new Path2D();
      for (const d of data.regions[n].paths) p.addPath(new Path2D(d));
      regions[n] = { path: p, cx: data.regions[n].cx, cy: data.regions[n].cy };
      hoverK[n] = 0;
    }
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (w === W && h === H && base) return;
    W = canvas.width = w; H = canvas.height = h;
    // the map sits in the upper part, clear of the narrative box and the cards at the bottom
    sc = Math.min(W * 0.86 / data.W, H * 0.6 / data.H);
    ox = (W - data.W * sc) / 2; oy = H * 0.36 - (data.H * sc) / 2;
    base = drawBase();
  }

  function paper(p) {
    p.fillStyle = "#fff"; p.fillRect(0, 0, W, H);
    let s = 9;
    const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < (W * H) / 300; i++) {
      p.fillStyle = `rgba(120,110,100,${0.02 + rnd() * 0.03})`;
      p.fillRect(rnd() * W, rnd() * H, 1 + rnd() * dpr, 1 + rnd() * dpr);
    }
  }

  // the resting map: every country outlined twice in pencil, each region with a faint wash of its colour
  function drawBase() {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const p = c.getContext("2d");
    paper(p);
    p.save(); p.translate(ox, oy); p.scale(sc, sc);
    for (const n of names) {
      const [r, gg, b] = TINT[n] || [200, 200, 200];
      p.fillStyle = `rgba(${r},${gg},${b},0.10)`; p.fill(regions[n].path);
    }
    p.lineJoin = "round";
    p.strokeStyle = "rgba(95,80,72,0.55)"; p.lineWidth = 0.9 * dpr / sc;
    for (const n of names) p.stroke(regions[n].path);
    p.translate(0.7 * dpr / sc, 0.5 * dpr / sc);
    p.strokeStyle = "rgba(150,120,110,0.18)"; p.lineWidth = 0.6 * dpr / sc;
    for (const n of names) p.stroke(regions[n].path);
    p.restore();
    return c;
  }

  // a region filled in coloured pencil: a wash, then diagonal strokes over it
  let hatch = null;
  function hatchPattern() {
    if (hatch) return hatch;
    const c = document.createElement("canvas"); c.width = c.height = 10;
    const p = c.getContext("2d");
    p.strokeStyle = "rgba(0,0,0,0.5)"; p.lineWidth = 1.1;
    p.beginPath(); p.moveTo(-2, 12); p.lineTo(12, -2); p.stroke();
    return (hatch = g.createPattern(c, "repeat"));
  }
  function fillRegion(n, k, strong) {
    if (k <= 0.001) return;
    const [r, gg, b] = TINT[n] || [200, 200, 200];
    g.save(); g.translate(ox, oy); g.scale(sc, sc);
    g.fillStyle = `rgba(${r},${gg},${b},${(strong ? 0.55 : 0.28) * k})`; g.fill(regions[n].path);
    g.globalAlpha = (strong ? 0.35 : 0.15) * k; g.globalCompositeOperation = "multiply";
    g.fillStyle = hatchPattern(); g.fill(regions[n].path);
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    g.strokeStyle = `rgba(${Math.round(r * 0.55)},${Math.round(gg * 0.45)},${Math.round(b * 0.45)},${0.8 * k})`;
    g.lineWidth = (strong ? 1.6 : 1.1) * dpr / sc; g.stroke(regions[n].path);
    g.restore();
  }

  function frame(now) {
    if (!running) return;
    resize();
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (!held) t += dt;
    g.drawImage(base, 0, 0);
    if (chosen) {                                               // the others step back
      g.fillStyle = `rgba(255,255,255,${0.45 * chosenK})`; g.fillRect(0, 0, W, H);
    }
    for (const n of names) {
      const want = n === hoverName && !chosen ? 1 : 0;
      if (!held) hoverK[n] += (want - hoverK[n]) * Math.min(1, dt * 6);
      fillRegion(n, hoverK[n], false);
    }
    if (runAt >= 0) fillRegion(names[runAt % names.length], 0.9, false);   // the light, running
    if (chosen) {
      fillRegion(chosen, chosenK, true);
      if (glow > 0.01) {
        const R = regions[chosen], x = ox + R.cx * sc, y = oy + R.cy * sc;
        const gl = g.createRadialGradient(x, y, 0, x, y, 160 * dpr);
        gl.addColorStop(0, `rgba(255,250,235,${0.55 * glow})`); gl.addColorStop(1, "rgba(255,250,235,0)");
        g.fillStyle = gl; g.fillRect(x - 170 * dpr, y - 170 * dpr, 340 * dpr, 340 * dpr);
        if (!held) glow *= 1 - dt * 0.6;
      }
    }
    requestAnimationFrame(frame);
  }

  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  async function untilUnheld() { while (held) await wait(80); }

  return {
    load,
    async show(ms = 1500) {
      await load();
      canvas.style.transition = `opacity ${ms}ms ease`;
      if (!running) { running = true; last = 0; requestAnimationFrame(frame); }
      requestAnimationFrame(() => { canvas.style.opacity = "1"; });
    },
    hide(ms = 2000) {
      canvas.style.transition = `opacity ${ms}ms ease`; canvas.style.opacity = "0";
      setTimeout(() => { if (canvas.style.opacity === "0") running = false; }, ms + 100);
    },
    hold(on) { held = !!on; },
    hover(name) { hoverName = name && regions[name] ? name : null; },
    async reveal(name, run = false) {
      if (!regions[name]) return;
      hoverName = null;
      if (run) {                                                // chance's light across the regions, slowing, stopping on it
        const target = names.indexOf(name), steps = names.length * 2 + ((target - 0 + names.length) % names.length);
        for (let s = 0; s <= steps; s++) { await untilUnheld(); runAt = s; await wait(70 + Math.max(0, s - steps + 6) * 60); }
        runAt = -1;
      }
      chosen = name; glow = 1;
      for (let k = 0; k <= 1.0001; k += 0.04) { await untilUnheld(); chosenK = k; await wait(30); }
    },
    reset() { chosen = null; chosenK = 0; hoverName = null; runAt = -1; glow = 0; for (const n of names) hoverK[n] = 0; },
  };
}
