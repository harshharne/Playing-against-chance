// The screen wakes out of black fog. Off, the screen is black. When a throw begins a life, the black turns to smoke,
// a hole opens in the middle and the smoke rolls outward, curling, until it settles into the fog frame's dark edges
// and fades. At the end of a life it rolls back in from the edges until the screen is black again.
//   const off = createOffFog(el)    el: the .off layer (black). Falls back to a plain fade without WebGL.
//   await off.to(up, ms)            up: true = open (the white screen), false = close (black)
// The WebGL context exists only while the fog moves, then it is let go (fewer contexts on the show machine).
const VS = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `
precision mediump float;
uniform vec2 res; uniform float t, k;                    // k: 0 black .. 1 open
float h(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(p); p = p * 2.03 + 3.7; a *= 0.5; } return s; }
void main() {
  vec2 uv = gl_FragCoord.xy / res, a = vec2(res.x / res.y, 1.0), p = (uv - 0.5) * a;
  vec2 dir = p / max(length(p), 1e-3);
  vec2 s = p - dir * k * 0.3;                            // the smoke drifts outward as it opens
  vec2 w1 = vec2(fbm(s * 1.6 + vec2(t * 0.11, t * 0.05)), fbm(s * 1.6 + vec2(-t * 0.09, t * 0.07) + 7.3));
  vec2 q = s + (w1 - 0.5) * 0.9;                         // curl: noise pushed around by noise
  float roll = fbm(q * 2.2 + vec2(t * 0.08, -t * 0.05));
  float fine = fbm(q * 6.0 - vec2(t * 0.15, t * 0.08));
  float r = length(p / vec2(a.x, 1.0)) * 1.25;           // 0 in the middle, ~0.62 at the sides, ~0.88 in the corners
  float R = mix(-0.22, 1.12, k);                         // the hole's edge: at the end, past the corners (the fog frame has its own dark edges)
  float d = r - R + (roll - 0.5) * 0.5 + (fine - 0.5) * 0.16;
  float dark = smoothstep(-0.06, 0.2, d);                // the black, soft and torn
  float fringe = exp(-pow((d - 0.04) / 0.11, 2.0)) * (0.35 + 0.65 * roll);   // grey smoke at the edge of the black
  float fade = 1.0 - smoothstep(0.93, 1.0, k);           // (the last wisps)
  vec3 ink = vec3(0.025) + vec3(fringe * 0.32 * fine) + (h(gl_FragCoord.xy + t) - 0.5) * 0.025;
  float al = clamp(max(dark, fringe * 0.55), 0.0, 1.0) * fade;
  gl_FragColor = vec4(ink * al, al);
}`;

export function createOffFog(el) {
  let gl = null, draw = null, canvas = null, k = 0, run = 0;
  function make() {
    canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) { canvas = null; return false; }
    const sh = (ty, src) => { const x = gl.createShader(ty); gl.shaderSource(x, src); gl.compileShader(x); return x; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.warn("[offfog]", gl.getProgramInfoLog(pr)); gone(); return false; }
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = { res: gl.getUniformLocation(pr, "res"), t: gl.getUniformLocation(pr, "t"), k: gl.getUniformLocation(pr, "k") };
    draw = (t, kk) => {
      const w = Math.max(2, Math.round(el.clientWidth / 3)), hh = Math.max(2, Math.round(el.clientHeight / 3));   // soft: a third is plenty
      if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
      gl.viewport(0, 0, w, hh); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.res, w, hh); gl.uniform1f(U.t, t); gl.uniform1f(U.k, kk);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    el.appendChild(canvas);
    return true;
  }
  function gone() {                                            // let the context go
    try { const x = gl && gl.getExtension("WEBGL_lose_context"); if (x) x.loseContext(); } catch (e) {}
    if (canvas) canvas.remove();
    gl = draw = canvas = null;
  }
  function plain(up, ms) {                                     // (no WebGL: the old fade)
    el.style.background = "#000"; el.style.transition = `opacity ${Math.max(0, ms) / 1000}s ease`;
    el.style.opacity = up ? "0" : "1"; el.style.pointerEvents = up ? "none" : "";
    k = up ? 1 : 0;
    return new Promise(r => setTimeout(r, Math.max(0, ms)));
  }
  async function to(up, ms) {
    const mine = ++run, goal = up ? 1 : 0;
    if (ms <= 0 || (!draw && !make())) {
      if (draw && ms <= 0) gone();
      return plain(up, ms);
    }
    el.style.transition = "none"; el.style.opacity = "1"; el.style.background = "transparent"; el.style.pointerEvents = up ? "none" : "";
    const from = k, t0 = performance.now(), tBase = 40 + Math.random() * 60;
    await new Promise(res => {
      (function tick(now) {
        if (mine !== run) return res();                        // a newer change took over
        const x = Math.min(1, (now - t0) / Math.max(1, ms));
        const e = x * x * x * (x * (x * 6 - 15) + 10);         // slow to part, slow to settle
        k = from + (goal - from) * e;
        draw(tBase + (now - t0) / 1000, k);
        if (x < 1) requestAnimationFrame(tick); else res();
      })(t0);
    });
    if (mine !== run) return;
    gone();                                                    // still now: black (a plain colour) or nothing at all
    el.style.background = "#000"; el.style.opacity = up ? "0" : "1";
  }
  return { to, get k() { return k; } };
}
