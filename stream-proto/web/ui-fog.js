// The FOG style of the game's screen (switch with U; the other style is the glass one in game.html).
//
// The screen is a clean sheet: its edges dark, a white fog drifting inside them, and the painted world showing
// through the middle as if the fog were the canvas it forms on. No boxes, no narrative window (the voice carries
// the words): only letters. The event is called out, its options come up along the bottom, the one you pick is
// set in the middle with its throw, the die's number lands alone. Letters form out of the fog and go back into it.
//
// The lettering: one high-contrast display serif (Noto Serif Display, which has true narrow widths). Capitals; in a
// block of two lines the first is heavier, the second light and tracked out; ONE letter per block is the same face
// at its narrowest and much taller, rising above its line or dropping through the next. Lines justified (gently) to
// one width.
//
// The fog moves: it rolls and curls (warped noise), its edges breathe, wisps drift over the picture, and it
// thickens over the middle at every change of place, so each new world forms out of it (fog.swell).
//
//   const fog = createFog({ root, sec })      root: the element over the picture (.gen)
//   fog.active(on)                            show / hide the frame and its letters
//   await fog.say({ k, t, s, cls, begin })    the same calls as the glass window; most words aren't shown here
//   fog.unsay()
//   const i = await fog.deck(cards, onHover, setKeys)
//   await fog.lock(i, label) · fog.hint(text) · fog.hide() · fog.show() · await fog.land(n, hit)
//   await fog.turnOver(card, note) · fog.deckGone() · fog.swell(ms)   (a change of place: the fog rolls in, then clears)

const TALL = 2.25;                     // how tall the tall letter is, in its line's letter size
const PREFER = "IMNHTEKLARU";          // letters that read well tall (straight stems; no round letters)
const SWELL = 0.5;                     // how thick the fog gets over the middle at a change of place

const CSS = `
@font-face { font-family: "PAC Display"; src: url("fonts/noto-serif-display-latin-wdth-normal.woff2") format("woff2"); font-weight: 100 900; font-stretch: 62.5% 100%; font-display: block; }
@font-face { font-family: "PAC Display"; src: url("fonts/noto-serif-display-latin-wdth-italic.woff2") format("woff2"); font-weight: 100 900; font-stretch: 62.5% 100%; font-style: italic; font-display: block; }
.fogc { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0; transition: opacity 1.2s ease; }
.fogl { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 0.8s ease; --ink: #121212; color: var(--ink); }
body.ui-fog .fogc, body.ui-fog .fogl { opacity: 1; }
body.ui-fog .say, body.ui-fog .deck, body.ui-fog .big, body.ui-fog .flip, body.ui-fog .pip { display: none !important; }
.fogl .stage { position: absolute; left: 10%; right: 10%; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; gap: 2.2vh; }
.fogl .row { position: absolute; left: 11%; right: 11%; bottom: 12.5%; display: flex; justify-content: space-evenly; align-items: flex-end; gap: 2vw; }
.fogl .note { font: 400 clamp(11px, 0.95vw, 14px)/1 "PAC Display", serif; letter-spacing: 0.34em; text-transform: uppercase; color: #333; }
.fogl .note b { font-weight: 600; color: var(--ink); }
.art { font-family: "PAC Display", "Noto Serif Display", "Didot", serif; text-transform: uppercase; text-align: center; line-height: 1; white-space: nowrap;
       text-shadow: 0 0 14px rgba(255,255,255,0.75); user-select: none; font-kerning: normal; }
.art .ln { display: block; }
.art .ln.a { font-weight: 560; letter-spacing: 0.05em; }
.art .ln.b { font-weight: 300; letter-spacing: 0.13em; }
.art .ln.one { font-weight: 520; letter-spacing: 0.06em; }
.art .ch { display: inline-block; transition: opacity 0.9s ease, filter 0.9s ease, transform 0.9s ease; }
.art .sp { display: inline-block; width: 0.3em; }
.art .tall { font-size: var(--tall, ${TALL}em); font-stretch: 62.5%; font-weight: 330; letter-spacing: 0; line-height: 0; margin: 0 0.01em; }
.art .tall.dn { transform: translateY(0.31em); }
.art .ch.pre { opacity: 0; filter: blur(12px); }
.art .ch.out { opacity: 0; filter: blur(10px); }
.prose { font: 300 clamp(20px, 2.1vw, 32px)/1.35 "PAC Display", "Noto Serif Display", serif; text-align: center; max-width: 30em; text-wrap: balance;
         text-shadow: 0 0 14px rgba(255,255,255,0.8); transition: opacity 1s ease, filter 1s ease; }
.prose.small { font-size: clamp(16px, 1.6vw, 24px); }
.prose.quote { font-style: italic; }
.prose.pre, .prose.out { opacity: 0; filter: blur(10px); }
.fogl .opt { pointer-events: auto; cursor: pointer; background: none; border: 0; padding: 1.2vh 0.4vw; color: inherit; transition: opacity 0.5s ease; font: inherit; }
.fogl .row.hovering .opt:not(.focus) { opacity: 0.32; }
.fogl .opt:focus-visible { outline: none; }
.fogl .opt.focus .art { text-shadow: 0 0 18px rgba(255,255,255,1); }
.fogl .begin { pointer-events: auto; cursor: pointer; background: none; border: 0; padding: 8px 14px; color: inherit; }
.fogl .num { font: 250 clamp(160px, 40vh, 380px)/0.9 "PAC Display", "Noto Serif Display", serif; font-stretch: 62.5%; text-shadow: 0 0 30px rgba(255,255,255,0.9); transition: opacity 0.9s ease, filter 0.9s ease; }
.fogl .num.pre, .fogl .num.out { opacity: 0; filter: blur(16px); }
.fogl .end { pointer-events: auto; max-height: 70vh; overflow: auto; font: 300 clamp(14px, 1.2vw, 18px)/1.5 "PAC Display", serif; text-shadow: 0 0 12px #fff; transition: opacity 1s; }
.fogl .end table { border-collapse: collapse; } .fogl .end td { padding: 1px 16px 1px 0; vertical-align: top; }
.fogl .end td:first-child { font-size: 0.8em; color: #555; } .fogl .end td:nth-child(2) { font-size: 0.78em; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 500; }
.fogl .end i { font-style: italic; color: #555; }
`;

// ---------- the frame: dark edges, white fog, the picture through the middle (WebGL, half resolution) ----------
const VS = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `
precision mediump float;
uniform vec2 res; uniform float t, veil, swell;
float h(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(p); p = p * 2.03 + 3.7; a *= 0.5; } return s; }
float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 uv = gl_FragCoord.xy / res, a = vec2(res.x / res.y, 1.0), p = (uv - 0.5) * a;
  // the fog rolls: noise pushed around by more noise, both moving, so it curls instead of sliding
  vec2 w1 = vec2(fbm(p * 1.7 + vec2(t * 0.06, t * 0.025)), fbm(p * 1.7 + vec2(-t * 0.05, t * 0.04) + 7.3));
  vec2 q = p + (w1 - 0.5) * 0.65;
  float roll = fbm(q * 2.3 + vec2(t * 0.045, -t * 0.03));
  float fine = fbm(q * 6.5 - vec2(t * 0.09, t * 0.05));
  float breath = sin(t * 0.35) * 0.012 + sin(t * 0.17 + 1.3) * 0.009;     // the edges breathe in and out
  float d = box(p, vec2(0.5 * a.x - 0.075 - breath, 0.5 - 0.075 - breath), 0.06);   // < 0 inside the sheet
  float e = d + (roll - 0.5) * 0.2 + (fine - 0.5) * 0.06;                  // the torn edge
  float fog = smoothstep(-0.17, -0.005, e) * (0.7 + 0.3 * fine);           // the white band inside the dark
  float wisp = smoothstep(0.56, 0.86, fbm(q * 1.5 + vec2(t * 0.07, t * 0.012))) * 0.24;   // wisps drifting over the picture
  float centre = 1.0 - 0.35 * smoothstep(0.0, 0.45, length(p / a));
  float haze = (veil + swell) * (0.45 + 0.55 * roll) * centre;             // thicker behind the letters, and at a change
  float dark = smoothstep(0.0, 0.07, e + (fine - 0.5) * 0.05);
  vec3 ink = vec3(0.04) + (h(gl_FragCoord.xy + t) - 0.5) * 0.03;
  float w = max(max(fog, haze), wisp);
  vec3 col = mix(vec3(1.0), ink, dark);
  float al = max(w, dark);
  gl_FragColor = vec4(col * al, al);
}`;

function frame(canvas) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const sh = (ty, src) => { const s = gl.createShader(ty); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.warn("[fog]", gl.getProgramInfoLog(pr)); return null; }
  gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = { res: gl.getUniformLocation(pr, "res"), t: gl.getUniformLocation(pr, "t"), veil: gl.getUniformLocation(pr, "veil"), swell: gl.getUniformLocation(pr, "swell") };
  return (t, veil, swell) => {
    const w = Math.max(2, Math.round(canvas.clientWidth / 2)), hh = Math.max(2, Math.round(canvas.clientHeight / 2));
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
    gl.viewport(0, 0, w, hh);
    gl.uniform2f(U.res, w, hh); gl.uniform1f(U.t, t); gl.uniform1f(U.veil, veil); gl.uniform1f(U.swell, swell);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
}

// ---------- the lettering ----------
const hash = (s) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
function splitLines(text) {                                   // one line, or two of about the same length
  const words = text.trim().split(/\s+/);
  if (words.length < 2 || text.length <= 10) return [words.join(" ")];
  let best = null;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(" "), b = words.slice(k).join(" "), cost = Math.abs(a.length - b.length);
    if (!best || cost < best.cost) best = { a, b, cost };
  }
  return [best.a, best.b];
}
function pickTall(lines, seed) {                              // [line, index, "up" | "dn"]: one tall letter per block
  if (lines.length === 1) return /[A-Za-z]/.test(lines[0][0] || "") ? [0, 0, "up"] : null;   // one line: a tall initial
  const li = seed % 5 < 3 ? 0 : 1;                             // two: the first line's rises above it, the last's drops through
  const ln = lines[li], dir = li === 0 ? "up" : "dn";
  let best = -1, score = -1;
  for (let i = 0; i < ln.length; i++) {
    const c = ln[i].toUpperCase(), r = PREFER.indexOf(c);
    if (r < 0) continue;
    const mid = 1 - Math.abs(i / Math.max(1, ln.length - 1) - 0.55);   // toward the middle
    const s = (PREFER.length - r) / PREFER.length + mid * 1.2 + ((seed >> (i % 16)) & 1) * 0.15;
    if (s > score) { score = s; best = i; }
  }
  return best < 0 ? null : [li, best, dir];
}
// the block as HTML: lines of letters, each its own span (they form out of the fog one by one)
export function artHTML(text, { size = "5vw", weights = ["a", "b"], tall: tallSize = null, initial = false } = {}) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const lines = splitLines(t);
  const tall = tallSize === 0 ? null : initial ? pickTall([lines[0]], 0) : pickTall(lines, hash(t));   // initial: only ever a tall first letter
  const out = lines.map((ln, li) => {
    const w = lines.length === 1 ? "one" : weights[li] || "b";
    const chars = [...ln].map((c, i) => {
      if (c === " ") return `<span class="ch sp"> </span>`;
      const isTall = tall && tall[0] === li && tall[1] === i;
      return `<span class="ch${isTall ? " tall " + tall[2] : ""}">${c.replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[x]))}</span>`;
    }).join("");
    return `<span class="ln ${w}">${chars}</span>`;
  }).join("");
  return `<div class="art" style="font-size:${size}${tallSize ? `;--tall:${tallSize}em` : ""}">${out}</div>`;
}
// after it's on the page: the lines of a block spread (gently) to one width; too far apart and they stay centred
export function fitArt(el) {
  const lines = [...el.querySelectorAll(".ln")];
  if (lines.length < 2) return;
  lines.forEach(l => { l.style.letterSpacing = ""; l.style.marginRight = ""; });
  const ws = lines.map(l => { const r = document.createRange(); r.selectNodeContents(l); return r.getBoundingClientRect().width; });
  const max = Math.max(...ws), fs = parseFloat(getComputedStyle(el).fontSize) || 16;
  lines.forEach((l, k) => {
    const n = [...l.textContent].length;
    if (n < 2 || max - ws[k] < 2) return;
    const base = parseFloat(getComputedStyle(l).letterSpacing) || 0;
    const ls = Math.min(fs * 0.3, base + (max - ws[k]) / (n - 1));
    l.style.letterSpacing = ls + "px"; l.style.marginRight = -ls + "px";     // (the last letter's spacing doesn't count)
  });
}

export function createFog({ root, sec }) {
  const style = document.createElement("style"); style.textContent = CSS; document.head.appendChild(style);
  const canvas = Object.assign(document.createElement("canvas"), { className: "fogc" });
  const layer = Object.assign(document.createElement("div"), { className: "fogl" });
  layer.innerHTML = `<div class="stage" aria-live="polite"></div><div class="row" role="group" aria-label="Your options"></div>`;
  const dbg = root.querySelector(".debug");
  root.insertBefore(canvas, dbg); root.insertBefore(layer, dbg);
  const stage = layer.querySelector(".stage"), row = layer.querySelector(".row");
  const draw = frame(canvas);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  let on = false, veil = 0.08, veilTo = 0.08, sw0 = 0, sw1 = 0;
  (function tick(now) {
    veil += (veilTo - veil) * 0.04;
    let swell = 0;                                             // a change of place: rolls in over its first quarter, clears over the rest
    if (now < sw1) { const k = (now - sw0) / (sw1 - sw0), e = k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75; swell = SWELL * e * e * (3 - 2 * e); }
    if (on && draw && !document.hidden) draw(now / 1000, veil, swell);
    requestAnimationFrame(tick);
  })(0);
  const fade = () => Math.max(400, sec("fade"));
  const spread = (el, span) => el.querySelectorAll(".ch").forEach(c => { c.style.transitionDelay = (Math.random() * span).toFixed(0) + "ms"; });

  async function show(el, span = 700) {                        // the letters form out of the fog
    el.querySelectorAll(".ch, .prose, .num").forEach(c => c.classList.add("pre"));
    if (el.classList.contains("prose") || el.classList.contains("num")) el.classList.add("pre");
    await document.fonts.ready.catch(() => {});
    (el.classList.contains("art") ? [el] : [...el.querySelectorAll(".art")]).forEach(fitArt);
    spread(el, span);
    await frames();
    el.querySelectorAll(".pre").forEach(c => c.classList.remove("pre")); el.classList.remove("pre");
    await sleep(span * 0.6 + 600);
  }
  async function vanish(el, span = 350) {                      // and go back into it
    if (!el || !el.isConnected) return;
    spread(el, span);
    el.querySelectorAll(".ch, .prose, .num").forEach(c => c.classList.add("out"));
    if (el.classList.contains("prose") || el.classList.contains("num")) el.classList.add("out");
    await sleep(span + 900);
    el.remove();
  }
  const plain = (html) => { const d = document.createElement("div"); d.innerHTML = String(html || ""); return d.textContent.trim(); };
  const node = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild || d; };
  const sizeFor = (text, big) => { const n = String(text).length; return big ? (n <= 8 ? "7vw" : n <= 16 ? "5.2vw" : "4.2vw") : (n <= 12 ? "3.6vw" : "3vw"); };

  // ---------- the words ----------
  let shown = [];
  async function unsay() {
    const els = shown; shown = [];
    veilTo = 0.08;
    await Promise.all(els.map(e => vanish(e)));
  }
  async function say({ k = "", t = "", s = "", cls = "", begin = false, onBegin = null }) {
    await unsay();
    if (/\bbridge\b/.test(cls)) return;                        // the words between events: the voice says them
    const els = [];
    if (begin) {                                               // the opening, and the end: the name, and the way in
      if (/\bend\b/.test(cls)) els.push(node(`<div class="end">${s}</div>`));
      else els.push(node(artHTML(plain(k) || plain(t), { size: "6vw" })));
      const b = node(`<button type="button" class="begin"><span class="note">begin</span></button>`);
      b.addEventListener("click", () => onBegin && onBegin());
      els.push(b);
    } else if (/\bend\b/.test(cls)) {
      els.push(node(`<div class="end">${s}</div>`));
    } else if (t && plain(t).length <= 26 && !/[.,;:!?]\s/.test(plain(t))) {
      els.push(node(artHTML(plain(t), { size: sizeFor(plain(t), true) })));   // the event's name, or what came
    } else if (t || s) {
      const words = plain(t) || plain(s);
      els.push(node(`<div class="prose ${/\bsmall\b/.test(cls) ? "small" : ""} ${/\bquote\b/.test(cls) ? "quote" : ""}">${words.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</div>`));
    }
    if (!els.length) return;
    veilTo = 0.32;
    els.forEach(e => stage.appendChild(e)); shown = els;
    await Promise.all(els.map(e => show(e, /\bend\b/.test(cls) ? 200 : 800)));
  }

  // ---------- the options, along the bottom ----------
  let opts = [], chosen = null, centre = [];
  function deck(cards, onHover, setKeys) {
    row.innerHTML = ""; row.className = "row";
    const size = cards.length > 5 ? "max(17px, 1.75vw)" : cards.length > 3 ? "max(19px, 2.1vw)" : "max(22px, 2.5vw)";
    opts = cards.map((c, i) => {
      const b = node(`<button type="button" class="opt" aria-label="${String(c.name).replace(/"/g, "&quot;")}">${artHTML(c.name, { size, tall: 1.55, initial: true })}</button>`);
      row.appendChild(b); return b;
    });
    veilTo = 0.26;
    return new Promise(async resolve => {
      for (const o of opts) { show(o, 600); await sleep(Math.max(120, sec("card_rise"))); }
      await sleep(700);
      let focus = -1, open = true;
      const setFocus = (i) => { focus = (i + opts.length) % opts.length; opts.forEach((o, k) => o.classList.toggle("focus", k === focus)); row.classList.add("hovering"); onHover && onHover(focus); };
      const pick = (i) => { if (!open) return; open = false; setKeys(null); row.classList.remove("hovering"); onHover && onHover(-1); resolve(i); };
      opts.forEach((o, i) => {
        o.addEventListener("click", () => pick(i));
        o.addEventListener("mouseenter", () => setFocus(i));
        o.addEventListener("mouseleave", () => { row.classList.remove("hovering"); opts.forEach(x => x.classList.remove("focus")); onHover && onHover(-1); });
      });
      setKeys((key) => {
        if (key === "ArrowRight") setFocus(focus + 1);
        else if (key === "ArrowLeft") setFocus(focus - 1);
        else if ((key === "Enter" || key === " ") && focus >= 0) pick(focus);
        else { const n = parseInt(key, 10); if (n >= 1 && n <= opts.length) pick(n - 1); }
      });
    });
  }
  // your option, set in the middle, with what the die must show under it
  async function lock(i, label, name) {
    chosen = { name, label, hint: "" };
    await Promise.all(opts.map(o => vanish(o, 300)));
    opts = []; row.innerHTML = "";
    await placeCentre();
  }
  async function placeCentre() {
    const els = [node(artHTML(chosen.name, { size: sizeFor(chosen.name, true) })),
                 node(`<div class="note">throw <b>${String(chosen.label).replace(/[&<>]/g, "")}</b></div>`)];
    if (chosen.hint) els.push(node(`<div class="note">${chosen.hint}</div>`));
    veilTo = 0.3;
    els.forEach(e => stage.appendChild(e)); centre = els;
    await Promise.all(els.map(e => show(e, 700)));
  }
  function hint(text) {                                        // "press R" · "3 throws" (shown with the option)
    if (!chosen) return;
    chosen.hint = String(text || "");
    const last = centre[2];
    if (last && last.isConnected) last.textContent = chosen.hint;
    else if (centre.length && chosen.hint) { const n = node(`<div class="note">${chosen.hint}</div>`); stage.appendChild(n); centre.push(n); show(n, 200); }
  }
  async function hide() { const els = centre; centre = []; await Promise.all(els.map(e => vanish(e, 250))); }
  async function showAgain() { if (chosen) await placeCentre(); }

  // the die's number, alone; then hit or miss, small
  async function land(n, hit) {
    const num = node(`<div class="num">${n}</div>`), word = node(`<div class="note">${hit ? "hit" : "miss"}</div>`);
    word.style.opacity = "0"; word.style.transition = "opacity 0.6s";
    veilTo = 0.36;
    stage.appendChild(num); stage.appendChild(word);
    await show(num, 0);
    await sleep(Math.max(300, sec("land") * 0.45));
    word.style.opacity = "1";
    await sleep(Math.max(500, sec("land") * 0.45));
    await Promise.all([vanish(num), (async () => { word.style.opacity = "0"; await sleep(700); word.remove(); })()]);
  }
  // what chance gave instead: it forms slowly where yours was
  async function turnOver(card, note) {
    const lab = node(`<div class="note">${String(note).toLowerCase()}</div>`), name = node(artHTML(card.name, { size: sizeFor(card.name, true) }));
    veilTo = 0.32;
    stage.appendChild(lab); stage.appendChild(name);
    await Promise.all([show(lab, 200), show(name, 1600)]);
    await sleep(Math.max(1200, sec("miss")));
    await Promise.all([vanish(lab), vanish(name, 600)]);
  }
  function deckGone() {
    chosen = null;
    for (const e of [...centre, ...opts]) vanish(e, 250);
    centre = []; opts = [];
    veilTo = 0.08;
  }
  function active(v) {
    on = !!v; document.body.classList.toggle("ui-fog", on);
    if (!on) { stage.innerHTML = ""; row.innerHTML = ""; shown = []; centre = []; opts = []; chosen = null; }
  }
  function swell(ms) { sw0 = performance.now(); sw1 = sw0 + Math.max(1500, ms); }
  return { swell, active, say, unsay, deck, lock, hint, hide, show: showAgain, land, turnOver, deckGone, get on() { return on; } };
}
