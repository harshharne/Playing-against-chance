// SCREEN on /panel: a small copy of what the game shows, twice a second, only while the panel is watching.
// The picture (and the drawn scenes, the baby, the fog frame) are canvases and are copied as they are; the words
// on screen are web text, so they are drawn again on top, where they stand, at their size, colour and fade.
//   startFeed({ root, isOff })   root: the element the game lives in · isOff(): the screen is black (no life yet)
export function startFeed({ root = document.body, isOff = () => false, width = 480, every = 500 } = {}) {
  const c = document.createElement("canvas"), g = c.getContext("2d");
  let watched = false, busy = false;
  setInterval(async () => {                                    // is anyone watching? (the server knows: the panel asks it)
    try { watched = !!(await (await fetch("/game/commands?after=999999999", { cache: "no-store" })).json()).watched; } catch (e) { watched = false; }
  }, 2000);
  const opacityOf = (el) => {                                  // its own fade times every parent's
    let o = 1;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden") return 0;
      o *= +cs.opacity;
      if (o < 0.02) return 0;
    }
    return o;
  };
  function shot() {
    const W = innerWidth, H = innerHeight, s = width / W;
    c.width = width; c.height = Math.round(H * s);
    g.fillStyle = "#eceae6"; g.fillRect(0, 0, c.width, c.height);
    for (const cv of root.querySelectorAll("canvas")) {        // the canvases, back to front, as the page stacks them
      const r = cv.getBoundingClientRect(); if (r.width < 4 || !cv.width) continue;
      const o = opacityOf(cv); if (!o) continue;
      try {
        g.globalAlpha = o;
        const fit = getComputedStyle(cv).objectFit === "cover";
        if (fit) {                                             // (object-fit: cover: the middle of it)
          const k = Math.max(r.width / cv.width, r.height / cv.height), sw = r.width / k, sh = r.height / k;
          g.drawImage(cv, (cv.width - sw) / 2, (cv.height - sh) / 2, sw, sh, r.left * s, r.top * s, r.width * s, r.height * s);
        } else g.drawImage(cv, r.left * s, r.top * s, r.width * s, r.height * s);
      } catch (e) {}
    }
    g.globalAlpha = 1;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);   // the words, where they stand
    let n = 0;
    for (let t = walk.nextNode(); t && n < 400; t = walk.nextNode()) {
      const el = t.parentElement; if (!el || el.closest(".debug, script, style")) continue;
      const tt = getComputedStyle(el).textTransform;
      let txt = t.nodeValue; if (!txt || !txt.trim()) continue;
      if (tt === "uppercase") txt = txt.toUpperCase(); else if (tt === "lowercase") txt = txt.toLowerCase();
      const o = opacityOf(el); if (!o) continue;
      const cs = getComputedStyle(el), size = parseFloat(cs.fontSize) * s;
      if (size < 3) continue;
      const caps = /small-caps/.test(cs.fontVariant || cs.fontVariantCaps) ? "small-caps " : "";
      g.font = `${cs.fontStyle} ${caps}${cs.fontWeight} ${size}px ${cs.fontFamily}`;
      try { g.letterSpacing = cs.letterSpacing === "normal" ? "0px" : `${parseFloat(cs.letterSpacing) * s}px`; } catch (e) {}
      g.fillStyle = cs.color; g.globalAlpha = o; g.textBaseline = "top";
      const range = document.createRange(); range.selectNodeContents(t);
      const words = txt.split(/(\s+)/); let i = 0;
      for (const r of range.getClientRects()) {                  // one rect per line: the words that fit on it
        if (r.width < 1) continue;
        let line = "";
        while (i < words.length && g.measureText(line + words[i]).width <= r.width * s + size * 0.6) line += words[i++];
        if (!line && i < words.length) line = words[i++];
        g.fillText(line.trim(), r.left * s, r.top * s + (r.height * s - size) / 2);
      }
      n++;
    }
    g.globalAlpha = 1;
    if (isOff()) { g.fillStyle = "rgba(0,0,0,0.92)"; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#888"; g.font = "13px sans-serif"; g.fillText("the screen is black: waiting for the throw", 12, c.height - 22); }
  }
  setInterval(() => {
    if (!watched || busy || document.hidden) return;
    busy = true;
    try { shot(); } catch (e) { busy = false; return; }
    c.toBlob(b => {
      if (!b) { busy = false; return; }
      fetch("/game/frame", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: b }).catch(() => {}).finally(() => { busy = false; });
    }, "image/jpeg", 0.62);
  }, every);
}
