// The world on screen: one painted picture turning into the next, in slight 3D.
//
// Each world comes with a depth map (made on the server). This draws picture A turning into picture B:
//   parallax   near parts shift more than far ones as you move your head, so the painting reads as a space
//   dissolve   B doesn't ghost in over the whole frame at once: it soaks in in soft patches, the far parts first
//   push       the view moves in through each picture (near things growing a little faster than far ones), so a run
//              of pictures reads as travelling forward through the years, not as a slideshow
//
//   const px = createParallax()   -> null if WebGL isn't there (then the page crossfades flat, as before)
//   px.render(w, h, a, b, k, offX, offY, fx) -> a canvas.  a, b: { img, depth } (b may be null);  k: 0..1, how far b is in
//       fx: { wet, push, dolly, seed }   wet 0 = plain crossfade .. 1 = patchy;  push: how far the view moves in over
//       this change (a goes 0 -> push, b comes -push -> 0);  seed: which patches (a number per picture)
//   px.setPush(p)     the biggest push there will be: the picture rests zoomed in by that much, so its edges never show
//   px.forget(img)    free the texture of a picture that's gone (call before closing its ImageBitmap)

const VS = `attribute vec2 p; varying vec2 uv; void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 uv;
uniform sampler2D A, DA, B, DB;
uniform float k, zoom, za, zb, dolly, wet, seed;
uniform vec2 off;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float cloud(vec2 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.3 + 11.7) + 0.15 * vnoise(p * 5.1 + 3.1); }
vec4 look(sampler2D img, sampler2D dep, vec2 q, float z) {
  float d = texture2D(dep, q).r;                          // near = white = moves most
  float s = 1.0 + z * (1.0 + dolly * (d - 0.35));         // the push: near things grow a little faster than far ones
  return texture2D(img, (q - 0.5) / s + 0.5 + off * (d - 0.35));
}
void main() {
  vec2 q = (uv - 0.5) / zoom + 0.5;                       // a little zoomed in, so the edges never show
  q.y = 1.0 - q.y;                                        // pictures are uploaded top row first (ImageBitmaps ignore FLIP_Y)
  vec4 a = look(A, DA, q, za), b = look(B, DB, q, zb);
  // when each spot turns: soft patches (a different set for every picture), the far parts a little earlier
  float th = 0.62 * cloud(q * vec2(4.2, 2.6) + seed) + 0.38 * texture2D(DB, q).r;
  float m = clamp(k * (1.0 + wet) - th * wet, 0.0, 1.0);
  gl_FragColor = mix(a, b, m);
}`;

export function createParallax() {
  const c = document.createElement("canvas");
  const opts = { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false };
  let gl = c.getContext("webgl", opts);
  if (!gl) return null;
  let U = null, cache = new Map(), ok = false, push = 0.02;
  const DOLLY = 1.5;

  function setup() {                                       // also run again if the browser takes the GPU away and gives it back
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn("[parallax]", gl.getProgramInfoLog(prog)); return false; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    U = {};
    for (const n of ["k", "zoom", "za", "zb", "dolly", "wet", "seed", "off"]) U[n] = gl.getUniformLocation(prog, n);
    ["A", "DA", "B", "DB"].forEach((n, i) => gl.uniform1i(gl.getUniformLocation(prog, n), i));
    cache = new Map();
    return true;
  }
  ok = setup();
  if (!ok) return null;
  c.addEventListener("webglcontextlost", (e) => { e.preventDefault(); ok = false; });
  c.addEventListener("webglcontextrestored", () => { ok = setup(); });

  function tex(img) {                                      // one texture per picture, uploaded once
    let t = cache.get(img);
    if (t) return t;
    t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
      gl.texParameteri(gl.TEXTURE_2D, p, v);
    cache.set(img, t);
    return t;
  }
  const flat = (() => { const f = document.createElement("canvas"); f.width = f.height = 2; const x = f.getContext("2d"); x.fillStyle = "#595959"; x.fillRect(0, 0, 2, 2); return f; })();

  return {
    get ok() { return ok; },
    get textures() { return cache.size; },
    setPush(p) { push = Math.max(0, +p || 0); },
    forget(img) { const t = img && cache.get(img); if (t) { gl.deleteTexture(t); cache.delete(img); } },
    render(w, h, a, b, k, ox, oy, fx = {}) {
      if (!ok) return null;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      gl.viewport(0, 0, w, h);
      const B = b || a;
      [a.img, a.depth || flat, B.img, B.depth || flat].forEach((img, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex(img)); });
      const kk = b ? Math.max(0, Math.min(1, k)) : 0, p = b ? (+fx.push || 0) : 0;
      // at rest the picture is zoomed by: room for your head's shift + room for the biggest push (so nothing jumps when one starts)
      gl.uniform1f(U.zoom, 1 + Math.hypot(ox, oy) * 1.4 + 0.02 + push * (1 + DOLLY * 0.65));
      gl.uniform1f(U.k, kk); gl.uniform1f(U.za, p * kk); gl.uniform1f(U.zb, p * (kk - 1));
      gl.uniform1f(U.dolly, DOLLY); gl.uniform1f(U.wet, b ? Math.max(0, Math.min(1, +fx.wet || 0)) : 0);
      gl.uniform1f(U.seed, (+fx.seed || 0) % 97);
      gl.uniform2f(U.off, ox, oy);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return c;
    },
  };
}
