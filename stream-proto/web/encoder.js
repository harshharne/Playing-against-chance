// Encodes camera frames to JPEG off the page's main thread (the game's main thread is busy drawing the world).
// in: { bmp: ImageBitmap, w, h, q }  out: ArrayBuffer (a JPEG), or null
let c = null;
onmessage = async (e) => {
  const { bmp, w, h, q } = e.data;
  try {
    if (!c || c.width !== w || c.height !== h) c = new OffscreenCanvas(w, h);
    const g = c.getContext("2d");
    g.setTransform(-1, 0, 0, 1, w, 0);                       // as in a mirror
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await c.convertToBlob({ type: "image/jpeg", quality: q });
    const buf = await blob.arrayBuffer();
    postMessage(buf, [buf]);
  } catch (err) { postMessage(null); }
};
