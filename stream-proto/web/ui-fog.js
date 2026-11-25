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
.fogl { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 0.8s ease; --ink: #0e0e0e; color: var(--ink); }
body.ui-fog .fogc, body.ui-fog .fogl { opacity: 1; }
body.ui-fog .say, body.ui-fog .deck, body.ui-fog .big, body.ui-fog .flip, body.ui-fog .pip { display: none !important; }
.fogl .stage { position: absolute; left: 14%; right: 14%; top: 46%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; gap: 1.8vh; }
.fogl .row { position: absolute; left: 9%; right: 9%; bottom: 9%; display: grid; justify-items: center; align-items: end; row-gap: 1.6vh; column-gap: 1.2vw; }
/* the fog gathers behind the letters: a soft white cloud, no edges, so they read on any picture */
.fogl .art, .fogl .prose, .fogl .note, .fogl .num { position: relative; isolation: isolate; }
.fogl .art::before, .fogl .prose::before, .fogl .note::before, .fogl .num::before {
  content: ""; position: absolute; inset: -0.8em -0.9em; z-index: -1; pointer-events: none; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(255,255,255,0.9), rgba(255,255,255,0.72) 45%, rgba(255,255,255,0.32) 75%, rgba(255,255,255,0));
  filter: blur(var(--cloud-blur, 8px)); opacity: var(--cloud, 1); transition: opacity 1s ease; }
.fogl .note::before { inset: -0.9em -1.4em; }
.fogl .prose::before { inset: -1.3em -1.6em; }
.fogl .note { transition: opacity 0.8s ease; } .fogl .note.pre, .fogl .note.out { opacity: 0; }
.fogl .num::before { inset: 0 -0.2em; }
.fogl .pre::before, .fogl .out::before { opacity: 0; }
/* the options stand in one fog bank rising from the bottom band, not in clouds of their own */
.fogl .opt .art::before { display: none; }
.fogl .row { isolation: isolate; }
.fogl .row::before { content: ""; position: absolute; left: -9%; right: -9%; top: -60%; bottom: -80%; z-index: -1; pointer-events: none;
  background: radial-gradient(ellipse 60% 55% at 50% 62%, rgba(255,255,255,0.92), rgba(255,255,255,0.7) 50%, rgba(255,255,255,0) 100%);
  filter: blur(18px); opacity: 0; transition: opacity 1.2s ease; }
.fogl .row.up::before { opacity: 1; }
/* the avatar stands in the middle (body.avatar-on, set by the game): the words keep off its face. The event's name and
   what happened sit in the band above the head; the options stand in two columns at its sides, each in its own fog */
body.avatar-on .fogl .stage { top: 15%; left: 18%; right: 18%; gap: 1.2vh; }
body.avatar-on .fogl .stage .art { font-size: min(var(--fs, 5vw), calc(clamp(30px, 3.4vw, 72px) * var(--ts, 1))) !important; }
body.avatar-on .fogl .num { font-size: calc(clamp(80px, 16vh, 180px) * var(--ts, 1)); }
.fogl .row.sides { display: flex; justify-content: space-between; align-items: stretch; top: 24%; bottom: 12%; left: 2.5%; right: 2.5%; }
.fogl .row.sides .side { width: 22%; display: flex; flex-direction: column; justify-content: center; gap: 3.4vh; }
.fogl .row.sides::before { left: -3%; right: -3%; top: -12%; bottom: -12%;
  background: radial-gradient(ellipse 17% 52% at 11% 50%, rgba(255,255,255,0.9), rgba(255,255,255,0.62) 55%, rgba(255,255,255,0) 100%),
              radial-gradient(ellipse 17% 52% at 89% 50%, rgba(255,255,255,0.9), rgba(255,255,255,0.62) 55%, rgba(255,255,255,0) 100%); }
.fogl .note { font: 500 calc(clamp(13px, 1.05vw, 19px) * var(--ts, 1))/1 var(--font-event, "PAC Display", serif); letter-spacing: 0.3em; text-transform: uppercase; color: #1d1d1d; }
.fogl .note b { font-weight: 600; color: var(--ink); }
.art { font-family: var(--font-event, "PAC Display", "Noto Serif Display", "Didot", serif); text-transform: uppercase; text-align: center; line-height: 1; white-space: nowrap;
       text-shadow: 0 0 1px rgba(255,255,255,0.9), 0 0 9px rgba(255,255,255,0.7); user-select: none; font-kerning: normal; }
.art.o { font-family: var(--font-option, "PAC Display", "Noto Serif Display", "Didot", serif); }   /* an option (see typefaces.js) */
.art.o .ln.a, .art.o .ln.b, .art.o .ln.one { font-weight: 520; letter-spacing: 0.07em; }   /* an option's two lines: one weight, one spacing */
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
.prose { font: 400 calc(clamp(17px, 1.55vw, 28px) * var(--ts, 1))/1.4 var(--font-event, "PAC Display", "Noto Serif Display", serif); text-align: center; max-width: 22em; text-wrap: balance;
         text-shadow: 0 0 1px rgba(255,255,255,0.9), 0 0 8px rgba(255,255,255,0.7); transition: opacity 1s ease, filter 1s ease; }
.prose.small { font-size: calc(clamp(15px, 1.25vw, 22px) * var(--ts, 1)); }
.prose.quote { font-style: italic; }
.prose.pre, .prose.out { opacity: 0; filter: blur(10px); }
.fogl .opt { pointer-events: auto; cursor: pointer; background: none; border: 0; padding: 1vh 0.3vw; color: inherit; transition: opacity 0.5s ease; font: inherit; width: 100%; min-width: 0; }
.fogl .row.hovering .opt:not(.focus) { opacity: 0.32; }
.fogl .opt:focus-visible { outline: none; }
.fogl .opt.focus .art { text-shadow: 0 0 18px rgba(255,255,255,1); }
.fogl .begin { pointer-events: auto; cursor: pointer; background: none; border: 0; padding: 8px 14px; color: inherit; }
.fogl .num { font: 250 calc(clamp(120px, 30vh, 300px) * var(--ts, 1))/0.9 var(--font-event, "PAC Display", "Noto Serif Display", serif); font-stretch: 62.5%; text-shadow: 0 0 30px rgba(255,255,255,0.9); transition: opacity 0.9s ease, filter 0.9s ease; }
.fogl .num.pre, .fogl .num.out { opacity: 0; filter: blur(16px); }
/* the life, read back: on its own sheet of fog, dark and large enough to read from where the player stands */
.fogl .end { pointer-events: auto; max-height: 74vh; overflow: auto; padding: 2.4vh 3vw; border-radius: 18px; color: #111;
  font: 400 calc(clamp(15px, 1.25vw, 24px) * var(--ts, 1))/1.45 var(--font-event, "PAC Display", serif);
  background: rgba(255,255,255,0.86); box-shadow: 0 0 70px 50px rgba(255,255,255,0.86);   /* a sheet of fog: no hard edge */
  transition: opacity 1s; }
.fogl .end table { border-collapse: collapse; } .fogl .end td { padding: 2px 18px 2px 0; vertical-align: top; }
.fogl .end td:first-child { font-size: 0.8em; color: #444; text-align: right; } .fogl .end td:nth-child(2) { font-size: 0.74em; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; white-space: nowrap; }
.fogl .end i { font-style: italic; color: #444; }
`;

// ---------- the frame: dark edges, white fog, the picture through the middle (WebGL, half resolution) ----------
const VS = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `
precision mediump float;
uniform vec2 res; uniform float t, veil, swell;
float h(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n(p); p = p * 2.03 + 3.7; a *= 0.5; } return s; }
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
    const w = Math.max(2, Math.round(canvas.clientWidth / 3)), hh = Math.max(2, Math.round(canvas.clientHeight / 3));   // soft: a third is plenty
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
    if (i > 0 && ln[i - 1] !== " ") continue;                    // a word's first letter only (never mid-word)
    const c = ln[i].toUpperCase(), r = PREFER.indexOf(c);
    if (r < 0) continue;
    const mid = 1 - Math.abs(i / Math.max(1, ln.length - 1) - 0.55);   // toward the middle
    const s = (PREFER.length - r) / PREFER.length + mid * 1.2 + ((seed >> (i % 16)) & 1) * 0.15;
    if (s > score) { score = s; best = i; }
  }
  return best < 0 ? null : [li, best, dir];
}
// the block as HTML: lines of letters, each its own span (they form out of the fog one by one)
export function artHTML(text, { size = "5vw", weights = ["a", "b"], tall: tallSize = null, initial = false, option = false } = {}) {
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
  return `<div class="art${option ? " o" : ""}" style="font-size:${size}${tallSize ? `;--tall:${tallSize}em` : ""}">${out}</div>`;
}
// after it's on the page: the lines of a block spread (gently) to one width; too far apart and they stay centred
export function fitArt(el) {
  const lines = [...el.querySelectorAll(".ln")];
  if (lines.length < 2 || el.classList.contains("o")) return;   // (an option's lines stay as set: no stretched letters)
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

// a block wider than the room it has (a long option in a narrow column, a long title) is set smaller until it fits
export function fitInto(art, room = null) {
  const box = room || art.parentElement;
  if (!box) return;
  const max = box.clientWidth || box.getBoundingClientRect().width;
  if (!max) return;
  for (let k = 0; k < 4; k++) {
    let w = 0;
    for (const l of art.querySelectorAll(".ln")) { const r = document.createRange(); r.selectNodeContents(l); w = Math.max(w, r.getBoundingClientRect().width); }
    if (w <= max * 0.98) return;
    const fs = parseFloat(getComputedStyle(art).fontSize);
    art.style.fontSize = Math.max(11, fs * (max * 0.96) / w) + "px";
    fitArt(art);
  }
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
  let on = false, veil = 0.08, veilTo = 0.08, sw0 = 0, sw1 = 0, odd = false;
  (function tick(now) {
    odd = !odd;
    veil += (veilTo - veil) * 0.04;
    let swell = 0;                                             // a change of place: rolls in over its first quarter, clears over the rest
    if (now < sw1) { const k = (now - sw0) / (sw1 - sw0), e = k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75; swell = SWELL * e * e * (3 - 2 * e); }
    if (on && draw && !document.hidden && odd) draw(now / 1000, veil, swell);   // 30 times a second: fog is slow
    requestAnimationFrame(tick);
  })(0);
  const fade = () => Math.max(400, sec("fade"));
  const spread = (el, span) => el.querySelectorAll(".ch").forEach(c => { c.style.transitionDelay = (Math.random() * span).toFixed(0) + "ms"; });

  async function show(el, span = 700) {                        // the letters form out of the fog
    el.querySelectorAll(".ch, .prose, .num, .art, .note").forEach(c => c.classList.add("pre"));
    el.classList.add("pre");
    await document.fonts.ready.catch(() => {});
    (el.classList.contains("art") ? [el] : [...el.querySelectorAll(".art")]).forEach(a => { fitArt(a); fitInto(a); });
    spread(el, span);
    await frames();
    el.querySelectorAll(".pre").forEach(c => c.classList.remove("pre")); el.classList.remove("pre");
    await sleep(span * 0.6 + 600);
  }
  async function vanish(el, span = 350) {                      // and go back into it
    if (!el || !el.isConnected) return;
    spread(el, span);
    el.querySelectorAll(".ch, .prose, .num, .art, .note").forEach(c => c.classList.add("out"));
    el.classList.add("out");
    await sleep(span + 900);
    el.remove();
  }
  const plain = (html) => { const d = document.createElement("div"); d.innerHTML = String(html || ""); return d.textContent.trim(); };
  const node = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild || d; };
  const sc = (x) => `calc(${x} * var(--ts, 1))`;              // TYPE SIZE on /panel scales every size
  const sizeFor = (text, big) => { const n = String(text).length;
    return sc(big ? (n <= 8 ? "clamp(40px, 4.8vw, 104px)" : n <= 16 ? "clamp(34px, 3.8vw, 84px)" : "clamp(28px, 3vw, 66px)") : (n <= 12 ? "clamp(26px, 2.8vw, 60px)" : "clamp(22px, 2.3vw, 50px)")); };

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
    } else if (t && plain(t).length <= 34 && !/[.;:!?]\s/.test(plain(t))) {
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
    const sides = document.body.classList.contains("avatar-on");   // the avatar in the middle: the options at its sides
    row.innerHTML = ""; row.className = "row" + (sides ? " sides" : "");
    let into = () => row;
    if (sides) {                                               // the first half down the left, the rest down the right (1, 2, 3... in reading order)
      row.style.gridTemplateColumns = "";
      const l = node(`<div class="side l"></div>`), r = node(`<div class="side r"></div>`);
      row.appendChild(l); row.appendChild(r);
      const half = Math.ceil(cards.length / 2);
      into = (i) => (i < half ? l : r);
    } else {
      const cols = cards.length <= 5 ? cards.length : Math.ceil(cards.length / 2);          // more than five: two rows
      row.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    }
    const size = sc(sides ? "clamp(18px, 1.75vw, 36px)" : cards.length > 5 ? "clamp(17px, 1.6vw, 34px)" : cards.length > 3 ? "clamp(18px, 1.75vw, 36px)" : "clamp(20px, 2vw, 42px)");
    opts = cards.map((c, i) => {
      const b = node(`<button type="button" class="opt" aria-label="${String(c.name).replace(/"/g, "&quot;")}">${artHTML(c.name, { size, tall: 1.55, initial: true, option: true })}</button>`);
      into(i).appendChild(b); return b;
    });
    veilTo = 0.26;
    row.classList.add("up");
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
    opts = []; row.innerHTML = ""; row.classList.remove("up");
    await placeCentre();
  }
  async function placeCentre() {
    const els = [node(artHTML(chosen.name, { size: sizeFor(chosen.name, true), option: true })),
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
    const lab = node(`<div class="note">${String(note).toLowerCase()}</div>`), name = node(artHTML(card.name, { size: sizeFor(card.name, true), option: true }));
    veilTo = 0.32;
    stage.appendChild(lab); stage.appendChild(name);
    await Promise.all([show(lab, 200), show(name, 1600)]);
    await sleep(Math.max(1200, sec("miss")));
    await Promise.all([vanish(lab), vanish(name, 600)]);
  }
  function deckGone() {
    chosen = null; row.classList.remove("up");
    for (const e of [...centre, ...opts]) vanish(e, 250);
    centre = []; opts = [];
    veilTo = 0.08;
  }
  function active(v) {
    on = !!v; document.body.classList.toggle("ui-fog", on);
    if (!on) { stage.innerHTML = ""; row.innerHTML = ""; shown = []; centre = []; opts = []; chosen = null; }
  }
  function setScale(v) { layer.style.setProperty("--ts", String(Math.max(0.6, Math.min(1.6, +v || 1)))); }
  function swell(ms) { sw0 = performance.now(); sw1 = sw0 + Math.max(1500, ms); }
  return { setScale, swell, active, say, unsay, deck, lock, hint, hide, show: showAgain, land, turnOver, deckGone, get on() { return on; } };
}
