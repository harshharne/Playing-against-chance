// The world in slight 3D: each painted world has a depth map (made once on the server); this shifts near parts more
// than far ones as you move, so the painting reads as a space. Two worlds at once for the crossfade between them.
//
//   const px = createParallax()   -> null if WebGL isn't there (then the world is drawn flat, as before)
//   px.render(w, h, a, aDepth, b, bDepth, k, offX, offY) -> a canvas: world a crossfaded to world b by k (0..1)

const VS = `attribute vec2 p; varying vec2 uv; void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `precision mediump float;
varying vec2 uv;
uniform sampler2D A, DA, B, DB;
uniform float k, zoom;
uniform vec2 off;
vec4 look(sampler2D img, sampler2D dep, vec2 q) {
  float d = texture2D(dep, q).r;                  // near = white = moves most
  return texture2D(img, q + off * (d - 0.35));
}
void main() {
  vec2 q = (uv - 0.5) / zoom + 0.5;               // a little zoomed in, so the edges never show
  q.y = 1.0 - q.y;                                // pictures are uploaded top row first (ImageBitmaps ignore FLIP_Y)
  gl_FragColor = mix(look(A, DA, q), look(B, DB, q), k);
}`;

export function createParallax() {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n) => gl.getUniformLocation(prog, n);
  ["A", "DA", "B", "DB"].forEach((n, i) => gl.uniform1i(U(n), i));
  const uk = U("k"), uz = U("zoom"), uo = U("off");

  const cache = new WeakMap();                     // one texture per picture, uploaded once
  function tex(img) {
    if (cache.has(img)) return cache.get(img);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
      gl.texParameteri(gl.TEXTURE_2D, p, v);
    cache.set(img, t);
    return t;
  }
  const flat = (() => { const f = document.createElement("canvas"); f.width = f.height = 2; const x = f.getContext("2d"); x.fillStyle = "#595959"; x.fillRect(0, 0, 2, 2); return f; })();

  return {
    render(w, h, a, ad, b, bd, k, ox, oy) {
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      gl.viewport(0, 0, w, h);
      const ts = [a || b, ad || flat, b || a, bd || flat];
      ts.forEach((img, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex(img)); });
      gl.uniform1f(uk, b ? k : 0); gl.uniform1f(uz, 1 + Math.hypot(ox, oy) * 1.4 + 0.02);
      gl.uniform2f(uo, ox, oy);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return c;
    },
  };
}
