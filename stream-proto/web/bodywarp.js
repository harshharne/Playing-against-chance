// BODY: the painted portrait's body moves with yours. The animator (LivePortrait, on the GPU) moves the face; this
// bends the rest of the painting, in the browser, to follow your shoulders and arms.
//
// How: the painting's own skeleton (its shoulders, elbows, wrists, found once per portrait) is the REST pose. Your
// skeleton (from the camera, every frame) says how the body has moved. A grid laid over the painting is bent by a
// few "bones" (linear blend skinning, as in any 2D puppet):
//   hips   the bottom of the painting: never moves (it melts into the world)
//   chest  leans, sways and grows a little as you lean in (from your shoulder line, against where you usually stand)
//   head   rides on the neck, without turning (the animator turns the head)
//   arms   upper arm and forearm on each side follow the angles of yours, measured against your shoulder line
// The same painting is bent, so the face and clothes can't change. What it can't do: fingers, a body turning away,
// and an arm crossing in front of the body stretches the painting between them.
//
//   const bw = createBodyWarp()                  null if there's no WebGL
//   const rig = bw.rig(skel)                     the painting's skeleton -> its rig (or null: no shoulders found)
//   const m = createMotion()                     your movement, smoothed: m.update(skel, dt), m.reset()
//   bw.render(src, rig, m.state, w, h) -> canvas the bent painting, in a frame with room around it (see MARGIN)
//
// A skeleton: { ls, rs, le, re, lw, rw: [x, y, confidence] } (left/right = as seen on the screen, x and y in any
// units with square pixels: the painting's 0..1, the camera's pixels). fromMediaPipe / fromCoco make one.

export const MARGIN = { x: 0.35, top: 0.35 };            // room around the painting for a raised arm or a lean
const G = 40;                                              // the grid: G x G squares over the painting
const SEEN = 0.5;                                          // a joint counts as seen above this confidence
const LIM = { tilt: 0.3, swayX: 0.35, swayY: 0.22, grow: [0.93, 1.1] };   // how far the chest may go (radians, shoulder widths)

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const ang = (v) => Math.atan2(v[1], v[0]);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const seen = (p) => !!p && p[2] >= SEEN && isFinite(p[0]) && isFinite(p[1]);
function segDist(p, a, b) {                                // distance from p to the segment a-b, and how far along it (0..1)
  const ab = sub(b, a), ap = sub(p, a), L2 = ab[0] * ab[0] + ab[1] * ab[1] || 1e-9;
  const t = (ap[0] * ab[0] + ap[1] * ab[1]) / L2, tc = clamp(t, 0, 1);
  const q = [a[0] + ab[0] * tc, a[1] + ab[1] * tc];
  return [Math.hypot(p[0] - q[0], p[1] - q[1]), t];
}

// ---------- skeletons from the two pose readers ----------
function orient(s) {                                       // left/right by where they are on the screen, not by anatomy
  if (s.ls && s.rs && s.ls[0] > s.rs[0]) return { ls: s.rs, rs: s.ls, le: s.re, re: s.le, lw: s.rw, rw: s.lw };
  return s;
}
export function fromMediaPipe(lm, w = 1, h = 1, mirror = false) {   // 33 landmarks {x, y, visibility} (0..1)
  if (!lm || lm.length < 17) return null;
  const P = (i) => [(mirror ? 1 - lm[i].x : lm[i].x) * w, lm[i].y * h, lm[i].visibility ?? 1];
  return orient({ ls: P(11), rs: P(12), le: P(13), re: P(14), lw: P(15), rw: P(16) });
}
export function fromCoco(k, w = 1, h = 1) {                // 17 COCO keypoints [x, y, conf] in pixels
  if (!k || k.length < 11) return null;
  const P = (i) => [k[i][0] / w, k[i][1] / h, k[i][2]];
  return orient({ ls: P(5), rs: P(6), le: P(7), re: P(8), lw: P(9), rw: P(10) });
}

// ---------- your movement ----------
// What the camera says, smoothed, against where you usually stand (NEUTRAL: set at a reset, then following you
// very slowly, so the avatar comes back to the middle if you shift your place for good).
export function createMotion({ follow = 0.35, settle = 30 } = {}) {
  const st = { ok: 0, sway: [0, 0], tilt: 0, grow: 1, arms: [null, null] };
  let n = null;                                            // neutral: { mid, width, line }
  const vel = {};                                          // each value's recent direction of change (for the smoothing)
  const armSt = () => ({ up: [1, 0], fore: [1, 0], vu: 0, vf: 0 });
  st.arms = [armSt(), armSt()];
  function update(sk, dt = 33) {
    const a = clamp(dt / 1000 / Math.max(0.02, follow * 0.25), 0.05, 1);   // how quickly it follows you (per frame)
    if (!sk || !seen(sk.ls) || !seen(sk.rs)) {             // you're not there: everything eases back to rest
      const r = clamp(dt / 600, 0, 1);
      st.ok = Math.max(0, st.ok - r); st.sway = st.sway.map(v => v * (1 - r)); st.tilt *= 1 - r; st.grow += (1 - st.grow) * r;
      for (const m of st.arms) { m.vu *= 1 - r; m.vf *= 1 - r; }
      return st;
    }
    const mid = [(sk.ls[0] + sk.rs[0]) / 2, (sk.ls[1] + sk.rs[1]) / 2], line = ang(sub(sk.rs, sk.ls));
    const width = Math.hypot(sk.rs[0] - sk.ls[0], sk.rs[1] - sk.ls[1]) || 1;
    if (!n) n = { mid: mid.slice(), width, line };
    const k = clamp(dt / 1000 / settle, 0, 1);              // neutral follows where you stand, slowly; the level of your
    n.mid = [n.mid[0] + (mid[0] - n.mid[0]) * k, n.mid[1] + (mid[1] - n.mid[1]) * k];   // shoulders far more slowly (it's
    n.width += (width - n.width) * k; n.line += wrap(line - n.line) * k * 0.15;            // mostly the camera's own tilt)
    const sway = [clamp((mid[0] - n.mid[0]) / n.width, -LIM.swayX, LIM.swayX), clamp((mid[1] - n.mid[1]) / n.width, -LIM.swayY, LIM.swayY)];
    // like a one-euro filter: the reader's jitter (no steady direction) is smoothed hard, a real movement (a steady
    // direction) comes through quickly. ad(name, d, scale): d = how far the shown value is from the reading
    const ad = (key, d, scale) => { const v = (vel[key] || 0) + (d - (vel[key] || 0)) * 0.3; vel[key] = v; return clamp(a * (0.22 + Math.abs(v) / scale), a * 0.22, Math.min(1, a * 1.8)); };
    const tl = clamp(wrap(line - n.line), -LIM.tilt, LIM.tilt), gr = clamp(width / n.width, LIM.grow[0], LIM.grow[1]);
    st.sway = st.sway.map((v, i) => v + (sway[i] - v) * ad("s" + i, sway[i] - v, 0.05));
    st.tilt += (tl - st.tilt) * ad("t", tl - st.tilt, 0.04);
    st.grow += (gr - st.grow) * ad("g", gr - st.grow, 0.025);
    st.ok = Math.min(1, st.ok + clamp(dt / 400, 0, 1));
    [[sk.ls, sk.le, sk.lw], [sk.rs, sk.re, sk.rw]].forEach(([s, e, w], i) => {
      const m = st.arms[i];
      const vu = seen(e) ? 1 : 0, vf = seen(e) && seen(w) ? 1 : 0;
      // an arm's angle against your shoulder line, kept as a direction (so it smooths without jumping at +-180 deg)
      const go = (key, d, r) => { const q = [Math.cos(r), Math.sin(r)]; return mixDir(d, q, ad(key, wrap(r - ang(d)), 0.1)); };
      if (vu) m.up = go("u" + i, m.up, ang(sub(e, s)) - line);
      if (vf) m.fore = go("f" + i, m.fore, ang(sub(w, e)) - line);
      const b = clamp(dt / 350, 0, 1);                     // seen / not seen comes and goes softly
      m.vu += (vu - m.vu) * b; m.vf += (vf - m.vf) * b;
    });
    return st;
  }
  function mixDir(p, q, a) { const v = [p[0] + (q[0] - p[0]) * a, p[1] + (q[1] - p[1]) * a], l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
  return { state: st, update, reset() { n = null; }, get neutral() { return n; } };
}

// ---------- the painting's rig ----------
// rest: the painting's skeleton in its own 0..1 units. An arm is rigged only if it hangs roughly down (a painted
// arm folded across the body or out of the picture stays part of the chest).
// Two layers, so a moving arm never drags the body with it:
//   BODY  hips, chest, head. Where a rigged arm hangs OUTSIDE the torso (the band between the shoulders, down), the
//         body layer leaves it out: when the arm moves away you see the world behind, as you would.
//   ARMS  each arm on its own, rigid (upper arm, forearm and hand), drawn over the body. Inside the torso band only a
//         narrower arm is taken, so the chest doesn't travel with it (a sliver of the old arm can stay on the chest).
export function makeRig(rest) {
  if (!rest || !seen(rest.ls) || !seen(rest.rs)) return null;
  const S = [rest.ls, rest.rs].map(p => [p[0], p[1]]);
  const sw = Math.hypot(S[1][0] - S[0][0], S[1][1] - S[0][1]);
  if (!(sw > 0.08 && sw < 0.95)) return null;              // not a believable pair of shoulders
  const M0 = [(S[0][0] + S[1][0]) / 2, (S[0][1] + S[1][1]) / 2], line = ang(sub(S[1], S[0]));
  // the torso band: from each shoulder straight down (along the body's own "down"), a little inside the shoulder points
  const dn = [-Math.sin(line), Math.cos(line)], inset = 0.1 * sw, dir = sub(S[1], S[0]).map(v => v / sw);
  const q0 = [S[0][0] + dir[0] * inset, S[0][1] + dir[1] * inset], q1 = [S[1][0] - dir[0] * inset, S[1][1] - dir[1] * inset];
  const quad = [q0, q1, [q1[0] + dn[0] * 2, q1[1] + dn[1] * 2], [q0[0] + dn[0] * 2, q0[1] + dn[1] * 2]];
  // how far a point is OUTSIDE the band on its own side (negative: inside, in front of the body)
  const outside = (p, side) => { const v = sub(p, side ? q1 : q0); const across = v[0] * dir[0] + v[1] * dir[1]; return (side ? across : -across) / sw; };
  // an arm moves only if it can move cleanly: hanging down at the side, forearm pointing down too, the hand not in
  // front of the body. Any other arm (folded, on the lap, holding something) stays painted on the body.
  const why = [];
  const arms = [[rest.ls, rest.le, rest.lw], [rest.rs, rest.re, rest.rw]].map(([s, e, w], side) => {
    if (!seen(e)) { why.push("no elbow"); return null; }
    const up = ang(sub(e, s)) - line;                       // against the shoulder line: ~90 deg = hanging down
    if (Math.sin(up) < 0.6) { why.push("upper arm not hanging"); return null; }
    const fore = seen(w) ? ang(sub(w, e)) - line : up;
    if (Math.sin(fore) < 0.5) { why.push("forearm not hanging"); return null; }
    if (outside(e, side) < -0.04 || (seen(w) && outside(w, side) < -0.02)) { why.push("arm in front of the body"); return null; }
    const W = seen(w) ? [w[0], w[1]] : [e[0] + (e[0] - s[0]), e[1] + (e[1] - s[1])];
    const H = [W[0] + (W[0] - e[0]) * 0.4, W[1] + (W[1] - e[1]) * 0.4];   // the hand, past the wrist (not past the picture's edge)
    H[1] = Math.min(H[1], 1); H[0] = clamp(H[0], 0, 1);
    why.push("moves");
    return { S: [s[0], s[1]], E: [e[0], e[1]], W, H, up, fore };
  });
  const N = (G + 1) * (G + 1), wts = new Float32Array(N * 3), awts = new Float32Array(N * 4), pts = new Float32Array(N * 2);
  const neckY = M0[1];
  for (let j = 0, i = 0; j <= G; j++) for (let k = 0; k <= G; k++, i++) {
    const p = [k / G, j / G]; pts[i * 2] = p[0]; pts[i * 2 + 1] = p[1];
    const head = 1 - smooth(neckY - 0.42 * sw, neckY - 0.08 * sw, p[1]);   // above the neck: the head
    const chest = smooth(1.0, Math.min(0.97, neckY + 0.05), p[1]);        // 0 at the bottom edge, 1 at the shoulders
    wts[i * 3] = (1 - head) * (1 - chest); wts[i * 3 + 1] = (1 - head) * chest; wts[i * 3 + 2] = head;
    // the arm layers (one per arm, drawn separately so the two never pull on each other): every point moves with
    // that arm, rigidly; upper arm and forearm blend only around the elbow
    arms.forEach((A, s) => {
      if (!A) return;
      const tf = segDist(p, A.E, A.H)[1] * Math.hypot(A.H[0] - A.E[0], A.H[1] - A.E[1]) / sw, f = smooth(-0.1, 0.1, tf);
      awts[i * 4 + s * 2] = 1 - f; awts[i * 4 + s * 2 + 1] = f;
    });
  }
  return { sw, M0, line, arms, why, quad, wts, awts, pts, n: N, rU: 0.22 * sw, rF: 0.19 * sw };
}

// ---------- bending: the bones' movements for one frame ----------
function rot(a) { const c = Math.cos(a), s = Math.sin(a); return (p, o) => [o[0] + c * (p[0] - o[0]) - s * (p[1] - o[1]), o[1] + s * (p[0] - o[0]) + c * (p[1] - o[1])]; }
// -> { body: [hips, chest, head], arms: [L upper, L fore, R upper, R fore] }, each a function from rest to now
export function bones(rig, m) {
  const ok = m ? m.ok : 0, tilt = (m ? m.tilt : 0) * ok, grow = 1 + ((m ? m.grow : 1) - 1) * ok;
  const d = [(m ? m.sway[0] : 0) * rig.sw * ok, (m ? m.sway[1] : 0) * rig.sw * ok];
  const R = rot(tilt);                                      // (about the shoulders' middle: a tilt doesn't also slide them)
  const chest = (p) => { const q = [rig.M0[0] + (p[0] - rig.M0[0]) * grow, rig.M0[1] + (p[1] - rig.M0[1]) * grow]; const r = R(q, rig.M0); return [r[0] + d[0], r[1] + d[1]]; };
  const neck = [rig.M0[0], rig.M0[1] - 0.25 * rig.sw], nk = chest(neck), hd = [nk[0] - neck[0], nk[1] - neck[1]];
  const head = (p) => [p[0] + hd[0], p[1] + hd[1]];
  const arms = [];
  rig.arms.forEach((A, s) => {
    if (!A) { arms.push(chest, chest); return; }
    const ms = m && m.arms[s];
    const vu = ms ? ms.vu * ok : 0, vf = ms ? ms.vf * ok : 0;
    const du = tilt + vu * wrap(ang(ms ? ms.up : [1, 0]) - A.up);
    const df = tilt + vf * wrap(ang(ms ? ms.fore : [1, 0]) - A.fore) + (1 - vf) * (du - tilt);
    const S1 = chest(A.S), Ru = rot(du), Rf = rot(df);
    const upper = (p) => { const r = Ru(p, A.S); return [r[0] - A.S[0] + S1[0], r[1] - A.S[1] + S1[1]]; };
    const E1 = upper(A.E);
    arms.push(upper, (p) => { const r = Rf(p, A.E); return [r[0] - A.E[0] + E1[0], r[1] - A.E[1] + E1[1]]; });
  });
  return { body: [(p) => p, chest, head], arms };
}
// -> where the grid's points go now (0..1 painting units): { body, arms } (two grids: the two layers)
export function bend(rig, m, out = null) {
  const f = bones(rig, m), n = rig.n, o = out || { body: new Float32Array(n * 2), arms: [new Float32Array(n * 2), new Float32Array(n * 2)] };
  for (let i = 0; i < n; i++) {
    const p = [rig.pts[i * 2], rig.pts[i * 2 + 1]];
    let x = 0, y = 0;
    for (let b = 0; b < 3; b++) { const w = rig.wts[i * 3 + b]; if (w > 1e-4) { const q = f.body[b](p); x += w * q[0]; y += w * q[1]; } }
    o.body[i * 2] = x; o.body[i * 2 + 1] = y;
    for (let s = 0; s < 2; s++) {
      const wu = rig.awts[i * 4 + s * 2], wf = rig.awts[i * 4 + s * 2 + 1], g = o.arms[s];
      if (wu + wf < 1e-4) { g[i * 2] = x; g[i * 2 + 1] = y; continue; }
      const a = f.arms[s * 2](p), b = f.arms[s * 2 + 1](p);
      g[i * 2] = (a[0] * wu + b[0] * wf) / (wu + wf); g[i * 2 + 1] = (a[1] * wu + b[1] * wf) / (wu + wf);
    }
  }
  return o;
}

// ---------- drawing (WebGL: the painting on the bent grids, body first, arms over it) ----------
export function createBodyWarp() {
  const cv = document.createElement("canvas");
  const gl = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const vs = `attribute vec2 pos; attribute vec2 uv; varying vec2 v; void main() { v = uv; gl_Position = vec4(pos, 0.0, 1.0); }`;
  // which part of the painting each layer takes, decided in the painting's own (rest) coordinates
  const fs = `precision mediump float; varying vec2 v; uniform sampler2D tex;
    uniform int layer; uniform vec4 capU[2]; uniform vec4 capF[2]; uniform float rigged[2]; uniform float rU, rF; uniform vec2 quad[4]; uniform int which;
    float seg(vec2 p, vec2 a, vec2 b) { vec2 ab = b - a; float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0); return length(p - a - ab * t); }
    float side(vec2 p, vec2 a, vec2 b) { return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); }
    bool inTorso(vec2 p) { float s0 = side(p, quad[0], quad[1]), s1 = side(p, quad[1], quad[2]), s2 = side(p, quad[2], quad[3]), s3 = side(p, quad[3], quad[0]);
      return (s0 >= 0.0 && s1 >= 0.0 && s2 >= 0.0 && s3 >= 0.0) || (s0 <= 0.0 && s1 <= 0.0 && s2 <= 0.0 && s3 <= 0.0); }
    void main() {
      vec4 c = texture2D(tex, v);
      bool inside = inTorso(v);
      float k = inside ? 0.55 : 1.0;                        // inside the torso only a narrower arm counts
      float hard = 0.0, soft = 0.0;
      for (int i = 0; i < 2; i++) {
        if (rigged[i] < 0.5) continue;
        float d = min(seg(v, capU[i].xy, capU[i].zw) / rU, seg(v, capF[i].xy, capF[i].zw) / rF) / k;
        hard = max(hard, d < 0.95 ? 1.0 : 0.0);
        if (i == which) soft = 1.0 - smoothstep(0.95, 1.25, d);
      }
      if (layer == 0) { if (hard > 0.5 && !inside) discard; gl_FragColor = c; }
      else { if (soft <= 0.001) discard; gl_FragColor = c * soft; }
    }`;
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.warn("[bodywarp]", gl.getShaderInfoLog(o)); return o; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
  const U = {}; for (const n of ["layer", "capU", "capF", "rigged", "rU", "rF", "quad", "which"]) U[n] = gl.getUniformLocation(pr, n);
  const N = (G + 1) * (G + 1), idx = new Uint16Array(G * G * 6);
  for (let j = 0, q = 0; j < G; j++) for (let k = 0; k < G; k++) {
    const a = j * (G + 1) + k, b = a + 1, c = a + G + 1, d = c + 1;
    idx.set([a, b, c, b, d, c], q); q += 6;
  }
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  const uvb = gl.createBuffer(), posb = gl.createBuffer();
  const uv = new Float32Array(N * 2);
  for (let j = 0, i = 0; j <= G; j++) for (let k = 0; k <= G; k++, i++) { uv[i * 2] = k / G; uv[i * 2 + 1] = j / G; }
  gl.bindBuffer(gl.ARRAY_BUFFER, uvb); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(pr, "pos"), aUv = gl.getAttribLocation(pr, "uv");
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const pos = new Float32Array(N * 2), bent = { body: new Float32Array(N * 2), arms: [new Float32Array(N * 2), new Float32Array(N * 2)] };
  const stat = { ms: 0 };
  function draw(grid) {
    const fx = 1 + 2 * MARGIN.x, fy = 1 + MARGIN.top;
    for (let i = 0; i < N; i++) {
      pos[i * 2] = ((grid[i * 2] + MARGIN.x) / fx) * 2 - 1;
      pos[i * 2 + 1] = 1 - ((grid[i * 2 + 1] + MARGIN.top) / fy) * 2;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, posb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvb); gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
  }
  return {
    canvas: cv, stat,
    rig: makeRig,
    // src: the cut-out painting (square, with alpha). w, h: the frame's size in pixels (the painting is w / (1 + 2 MARGIN.x)
    // wide, standing at the bottom, in the middle)
    render(src, rig, m, w, h) {
      const t0 = performance.now();
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      if (!rig) return cv;
      bend(rig, m, bent);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      const cu = [], cf = [], rg = [];
      for (const A of rig.arms) { if (A) { cu.push(...A.S, ...A.E); cf.push(...A.E, ...A.H); rg.push(1); } else { cu.push(0, 0, 0, 0); cf.push(0, 0, 0, 0); rg.push(0); } }
      gl.uniform4fv(U.capU, cu); gl.uniform4fv(U.capF, cf); gl.uniform1fv(U.rigged, rg);
      gl.uniform1f(U.rU, rig.rU); gl.uniform1f(U.rF, rig.rF); gl.uniform2fv(U.quad, rig.quad.flat());
      gl.uniform1i(U.layer, 0); draw(bent.body);             // the body (without the arms that hang beside it)
      gl.uniform1i(U.layer, 1);                              // the arms, over it, one at a time
      rig.arms.forEach((A, s) => { if (A) { gl.uniform1i(U.which, s); draw(bent.arms[s]); } });
      stat.ms = performance.now() - t0;
      return cv;
    },
  };
}
