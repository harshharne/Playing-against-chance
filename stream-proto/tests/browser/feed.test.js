// SCREEN on /panel: the game sends a small picture of what it shows (twice a second) only while the panel watches,
// and the panel shows it. The words on screen are drawn into the picture too.
const L = require("../lib/standin.js"), { check, note, done } = require("../lib/check.js");
const fs = require("fs");
(async () => {
  const s = await L.standin({ life: "short" });
  const b = await L.browser(); const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const g = await ctx.newPage(); const errs = L.watchErrors(g);
  try {
    await L.post(s.url, "/game/live", { tempo: 0.5, voice: false, ui: "fog" });
    await g.goto(s.url + "/game?test"); await g.waitForTimeout(3000);
    const idle = await fetch(s.url + "/game/frame"); await g.waitForTimeout(3500);   // (asking once marks it watched)
    let unwatched = await (await fetch(s.url + "/game/commands?after=999999999")).json();
    const p = await ctx.newPage(); await p.goto(s.url + "/panel");
    await L.play(g, s.url, { secs: 40, until: (st, el) => st.event && st.event !== "not started" && el > 25 });
    const r = await fetch(s.url + "/game/frame"), buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync("/tmp/feed-frame.jpg", buf);
    const img = await p.evaluate(() => { const i = document.getElementById("f_img"); return { w: i.naturalWidth, note: document.getElementById("f_note").textContent }; });
    note(`frame: ${r.status}, ${buf.length} bytes, age ${r.headers.get("X-Age")} s · panel: ${img.w} px wide, "${img.note}"`);
    check(r.status === 200 && buf[0] === 0xff && buf[1] === 0xd8 && buf.length > 3000, "no picture from the game");
    check(+r.headers.get("X-Age") < 2, "the picture is old: the game isn't sending it twice a second");
    check(img.w >= 400 && /live/.test(img.note), `the panel doesn't show it ("${img.note}")`);
    await p.close(); await g.waitForTimeout(7000);
    unwatched = await (await fetch(s.url + "/game/commands?after=999999999")).json();
    check(unwatched.watched === false, "the game was told someone's watching after the panel closed");
    check(errs.length === 0, "errors in the game:\n      " + errs.slice(0, 5).join("\n      "));
  } finally { await b.close(); s.stop(); }
  done("feed (the panel sees the game's screen)");
})().catch(e => { console.log("FAIL feed\n   x " + e.stack); process.exit(1); });
