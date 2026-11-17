// The FOG style of the game's screen (switch with U; the other style is the glass one in game.html).
//
// The screen is a clean sheet: its edges dark, a white fog drifting inside them, and the painted world showing
// through the middle as if the fog were the canvas it forms on. No boxes, no narrative window (the voice carries
// the words): only letters. The event is called out, its options come up along the bottom, the one you pick is
// set in the middle with its throw, the die's number lands alone. Letters form out of the fog and go back into it.
//
// The lettering: serif capitals (Cinzel), and in every block of words ONE letter drawn tall and narrow (Cormorant),
// rising above its line or dropping through the one below; lines in a block justified to one width.
//
//   const fog = createFog({ root, sec })      root: the element over the picture (.gen)
//   fog.active(on)                            show / hide the frame and its letters
//   await fog.say({ k, t, s, cls, begin })    the same calls as the glass window; most words aren't shown here
//   fog.unsay()
//   const i = await fog.deck(cards, onHover, setKeys)
//   await fog.lock(i, label) · fog.hint(text) · fog.hide() · fog.show() · await fog.land(n, hit)
//   await fog.turnOver(card, note) · fog.deckGone()

const SX = 0.56;                       // how narrow the tall letter is drawn
const TALL = 2.4;                      // how tall, in the line's own letter size
const PREFER = "IMNEHTLAOCRVKU";       // letters that look best tall (strong verticals first)

const CSS = `
@font-face { font-family: "PAC Cinzel"; src: url("fonts/cinzel-latin-400-normal.woff2") format("woff2"); font-weight: 400; font-display: block; }
@font-face { font-family: "PAC Cinzel"; src: url("fonts/cinzel-latin-700-normal.woff2") format("woff2"); font-weight: 700; font-display: block; }
@font-face { font-family: "PAC Cormorant"; src: url("fonts/cormorant-garamond-latin-400-normal.woff2") format("woff2"); font-weight: 400; font-display: block; }
@font-face { font-family: "PAC Cormorant"; src: url("fonts/cormorant-garamond-latin-500-normal.woff2") format("woff2"); font-weight: 500; font-display: block; }
@font-face { font-family: "PAC Cormorant"; src: url("fonts/cormorant-garamond-latin-400-italic.woff2") format("woff2"); font-weight: 400; font-style: italic; font-display: block; }
.fogc { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0; transition: opacity 1.2s ease; }
.fogl { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 0.8s ease; --ink: #121212; color: var(--ink); }
body.ui-fog .fogc, body.ui-fog .fogl { opacity: 1; }
body.ui-fog .say, body.ui-fog .deck, body.ui-fog .big, body.ui-fog .flip, body.ui-fog .pip { display: none !important; }
.fogl .stage { position: absolute; left: 10%; right: 10%; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; gap: 2.2vh; }
.fogl .row { position: absolute; left: 11%; right: 11%; bottom: 12.5%; display: flex; justify-content: space-evenly; align-items: flex-end; gap: 2vw; }
.fogl .note { font: 400 clamp(11px, 1.05vw, 15px)/1 "PAC Cinzel", serif; letter-spacing: 0.32em; text-transform: uppercase; color: #3a3a3a; }
.fogl .note b { font-weight: 700; color: var(--ink); }
.art { font-family: "PAC Cinzel", "Cinzel", "Trajan Pro", serif; text-transform: uppercase; text-align: center; line-height: 0.98; white-space: nowrap;
       text-shadow: 0 0 22px rgba(255,255,255,0.95), 0 0 6px rgba(255,255,255,0.9); user-select: none; }
.art .ln { display: block; }
.art .ln.a { font-weight: 700; } .art .ln.b { font-weight: 400; }
.art .ch { display: inline-block; transition: opacity 0.9s ease, filter 0.9s ease, transform 0.9s ease; }
.art .sp { display: inline-block; width: 0.38em; }
.art .tall { font-family: "PAC Cormorant", "Cormorant Garamond", serif; font-weight: 500; font-size: ${TALL}em; line-height: 0; transform-origin: 50% 50%; }
.art .tall.up { transform: scaleX(${SX}); }
.art .tall.dn { transform: translateY(0.36em) scaleX(${SX}); }
.art .ch.pre { opacity: 0; filter: blur(12px); }
.art .ch.out { opacity: 0; filter: blur(10px); }
.art .tall.up.pre, .art .tall.up.out { transform: scaleX(${SX}) translateY(-0.06em); }
.prose { font: 400 clamp(20px, 2.3vw, 34px)/1.3 "PAC Cormorant", "Cormorant Garamond", serif; text-align: center; max-width: 30em; text-wrap: balance;
         text-shadow: 0 0 20px rgba(255,255,255,0.95), 0 0 6px rgba(255,255,255,0.9); transition: opacity 1s ease, filter 1s ease; }
.prose.small { font-size: clamp(16px, 1.6vw, 24px); }
.prose.quote { font-style: italic; }
.prose.pre, .prose.out { opacity: 0; filter: blur(10px); }
.fogl .opt { pointer-events: auto; cursor: pointer; background: none; border: 0; padding: 1.2vh 0.4vw; color: inherit; transition: opacity 0.5s ease; font: inherit; }
.fogl .row.hovering .opt:not(.focus) { opacity: 0.32; }
.fogl .opt:focus-visible { outline: none; }
.fogl .opt.focus .art { text-shadow: 0 0 26px rgba(255,255,255,1), 0 0 8px rgba(255,255,255,1); }
.fogl .begin { pointer-events: auto; cursor: pointer; background: none; border: 0; padding: 8px 14px; color: inherit; }
.fogl .num { font: 300 clamp(140px, 34vh, 330px)/0.9 "PAC Cormorant", "Cormorant Garamond", serif; text-shadow: 0 0 40px rgba(255,255,255,1); transition: opacity 0.9s ease, filter 0.9s ease; }
.fogl .num.pre, .fogl .num.out { opacity: 0; filter: blur(16px); }
.fogl .end { pointer-events: auto; max-height: 70vh; overflow: auto; font: 400 clamp(14px, 1.3vw, 19px)/1.45 "PAC Cormorant", serif; text-shadow: 0 0 14px #fff; transition: opacity 1s; }
.fogl .end table { border-collapse: collapse; } .fogl .end td { padding: 1px 16px 1px 0; vertical-align: top; }
.fogl .end td:first-child { font-family: "PAC Cinzel", serif; font-size: 0.8em; color: #555; } .fogl .end td:nth-child(2) { font-family: "PAC Cinzel", serif; font-size: 0.8em; letter-spacing: 0.1em; }
.fogl .end i { font-style: italic; color: #555; }
`;

// ---------- the frame: dark edges, white fog, the picture through the middle (WebGL, half resolution) ----------
const VS = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `
precision mediump float;
uniform vec2 res; uniform float t, veil;
float h(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(p); p = p * 2.03 + 3.7; a *= 0.5; } return s; }
float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 uv = gl_FragCoord.xy / res, a = vec2(res.x / res.y, 1.0), p = (uv - 0.5) * a;
  float d = box(p, vec2(0.5 * a.x - 0.075, 0.5 - 0.075), 0.06);            // < 0 inside the sheet
  vec2 drift = vec2(t * 0.011, -t * 0.007);
  float n1 = fbm(p * 2.4 + drift), n2 = fbm(p * 6.0 - drift * 1.7), n3 = fbm(p * 1.3 - drift * 0.6 + 9.0);
  float e = d + (n1 - 0.5) * 0.17 + (n2 - 0.5) * 0.05;                      // the torn edge, slowly moving
  float fog = smoothstep(-0.16, -0.005, e) * (0.75 + 0.25 * n2);           // the white band inside the dark
  float haze = veil * (0.55 + 0.45 * n3) * (1.0 - 0.35 * smoothstep(0.0, 0.45, length(p / a)));   // over the middle when letters are up
  float dark = smoothstep(0.0, 0.07, e + (n2 - 0.5) * 0.05);
  float hatch = 0.5 + 0.5 * sin((gl_FragCoord.x + gl_FragCoord.y * 0.55) * 1.15 + n2 * 4.0);   // the pen hatching, faint
  vec3 ink = vec3(0.045) + vec3(0.035) * hatch * smoothstep(0.02, 0.12, e) + (h(gl_FragCoord.xy) - 0.5) * 0.03;
  float w = max(fog, haze);
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
  const U = { res: gl.getUniformLocation(pr, "res"), t: gl.getUniformLocation(pr, "t"), veil: gl.getUniformLocation(pr, "veil") };
  return (t, veil) => {
    const w = Math.max(2, Math.round(canvas.clientWidth / 2)), hh = Math.max(2, Math.round(canvas.clientHeight / 2));
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
    gl.viewport(0, 0, w, hh);
    gl.uniform2f(U.res, w, hh); gl.uniform1f(U.t, t); gl.uniform1f(U.veil, veil);
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
  const li = lines.length === 1 ? 0 : (seed % 5 < 3 ? 0 : 1);
  const ln = lines[li], dir = lines.length === 1 ? (seed % 2 ? "up" : "dn") : li === 0 ? "up" : "dn";
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
export function artHTML(text, { size = "5vw", weights = ["a", "b"] } = {}) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const lines = splitLines(t), tall = pickTall(lines, hash(t));
  const out = lines.map((ln, li) => {
    const w = lines.length === 1 ? "a" : weights[li] || "b";
    const chars = [...ln].map((c, i) => {
      if (c === " ") return `<span class="ch sp"> </span>`;
      const isTall = tall && tall[0] === li && tall[1] === i;
      return `<span class="ch${isTall ? " tall " + tall[2] : ""}">${c.replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[x]))}</span>`;
    }).join("");
    return `<span class="ln ${w}">${chars}</span>`;
  }).join("");
  return `<div class="art" style="font-size:${size}">${out}</div>`;
}
// after it's on the page: pull the tall letter's neighbours in (it's drawn narrow), justify the lines to one width
export function fitArt(el) {
  for (const t of el.querySelectorAll(".tall")) {
    t.style.margin = "";
    const w = t.offsetWidth, m = -w * (1 - SX) / 2 + 1;
    t.style.margin = `0 ${m}px`;
  }
  const lines = [...el.querySelectorAll(".ln")];
  if (lines.length < 2) return;
  lines.forEach(l => { l.style.letterSpacing = ""; l.style.marginRight = ""; });
  const ws = lines.map(l => { const r = document.createRange(); r.selectNodeContents(l); return r.getBoundingClientRect().width; });
  const max = Math.max(...ws), fs = parseFloat(getComputedStyle(el).fontSize) || 16;
  lines.forEach((l, k) => {
    const n = [...l.textContent].length;
    if (n < 2 || max - ws[k] < 2) return;
    const ls = Math.min(fs * 0.9, (max - ws[k]) / (n - 1));
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
  let on = false, veil = 0.08, veilTo = 0.08;
  (function tick(now) {
    veil += (veilTo - veil) * 0.04;
    if (on && draw && !document.hidden) draw(now / 1000, veil);
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
  const sizeFor = (text, big) => { const n = String(text).length; return big ? (n <= 8 ? "8.2vw" : n <= 16 ? "6.2vw" : "4.8vw") : (n <= 12 ? "4.2vw" : "3.4vw"); };

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
      const b = node(`<button type="button" class="begin">${artHTML("Begin", { size: "1.7vw" })}</button>`);
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
    const size = cards.length > 5 ? "1.75vw" : cards.length > 3 ? "2.1vw" : "2.6vw";
    opts = cards.map((c, i) => {
      const b = node(`<button type="button" class="opt" aria-label="${String(c.name).replace(/"/g, "&quot;")}">${artHTML(c.name, { size })}</button>`);
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
  return { active, say, unsay, deck, lock, hint, hide, show: showAgain, land, turnOver, deckGone, get on() { return on; } };
}
