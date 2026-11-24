// Lives back to back in one page, as on a show day (the page is never reloaded): after each life, memory, WebGL
// textures, page elements, frame rate and errors. Fails if something keeps growing.
//   LIVES=8 node tests/browser/soak.test.js     (short lives, ~2 min each on the stand-in)
const L = require("../lib/standin.js"), { check, note, done } = require("../lib/check.js");
const LIVES = +(process.env.LIVES || 6);
(async () => {
  const s = await L.standin({ life: "short" });
  const b = await L.browser(); const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } }); const p = await ctx.newPage();
  const errs = L.watchErrors(p);
  const rows = [];
  try {
    await L.post(s.url, "/game/live", { tempo: 0.4, voice: false, world_rules: "ever" });
    await L.post(s.url, "/settings", { avatar: "portrait", body: "arms" });
    await p.goto(s.url + "/game?test"); await p.waitForTimeout(2500);
    await p.evaluate(() => { const bt = window.__pac.live._bodyTest;
      bt.rest({ ls: [0.33, 0.42, 0.99], rs: [0.67, 0.42, 0.99], le: [0.30, 0.62, 0.95], re: [0.70, 0.62, 0.95], lw: [0.29, 0.80, 0.95], rw: [0.71, 0.80, 0.95] });
      bt.live((now) => { const t = now / 1000, x = 640 + Math.sin(t * 0.4) * 40; return { ls: [x - 100, 360, 0.99], rs: [x + 100, 360, 0.99], le: [x - 100, 510, 0.95], lw: [x - 100, 640, 0.95], re: [x + 100, 510, 0.95], rw: [x + 100, 640, 0.95] }; }); });
    await p.mouse.click(640, 400);
    let lives = 0, ended = false, t0 = Date.now();
    await L.play(p, s.url, { secs: LIVES * 200,
      every: async (st) => {
        if (st.event === "the end") ended = true;
        else if (ended && st.event === "not started") {
          ended = false; lives++;
          const m = await p.evaluate(async () => {
            if (window.gc) { window.gc(); await new Promise(r => setTimeout(r, 300)); window.gc(); }
            const ws = window.__pac.live.worldState();
            return { heap: performance.memory ? performance.memory.usedJSHeapSize / 1e6 : 0, textures: ws.textures, queued: ws.queued,
                     nodes: document.getElementsByTagName("*").length, canvases: document.getElementsByTagName("canvas").length, fps: window.__pac.live.stat.drawFps || 0 };
          });
          rows.push({ life: lives, secs: Math.round((Date.now() - t0) / 1000), ...m }); t0 = Date.now();
          note(`life ${lives}: ${rows.at(-1).secs}s · heap ${m.heap.toFixed(1)} MB · textures ${m.textures} · elements ${m.nodes} · canvases ${m.canvases} · ${m.fps} fps`);
        }
      },
      until: () => lives >= LIVES });
    check(lives >= LIVES, `only ${lives} of ${LIVES} lives finished`);
    check(errs.length === 0, "errors in the page:\n      " + errs.slice(0, 5).join("\n      "));
    if (rows.length >= 3) {
      const a = rows[1], z = rows.at(-1);                       // (from the 2nd life: the first warms everything up)
      check(z.heap < a.heap * 1.3 + 15, `memory keeps growing: ${a.heap.toFixed(0)} -> ${z.heap.toFixed(0)} MB`);
      check(z.textures <= Math.max(a.textures, 4) + 2, `world textures keep growing: ${a.textures} -> ${z.textures}`);
      check(z.nodes <= a.nodes * 1.1 + 20, `page elements keep growing: ${a.nodes} -> ${z.nodes}`);
      check(z.canvases <= a.canvases + 1, `canvases keep growing: ${a.canvases} -> ${z.canvases}`);
    }
  } finally { await b.close(); s.stop(); }
  done(`soak (${LIVES} lives in one page)`);
})().catch(e => { console.log("FAIL soak\n   x " + e.stack); process.exit(1); });
