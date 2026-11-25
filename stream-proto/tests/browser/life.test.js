// A whole (short) life on the stand-in, played like a visitor: no errors, the screen never blank while it's on,
// the ever-changing world keeps changing, the portrait (a bust) arrives and stands in the middle, the life ends
// and the next one waits for the die.
const L = require("../lib/standin.js"), { check, note, done } = require("../lib/check.js");
(async () => {
  const s = await L.standin({ life: "short" });
  const b = await L.browser(); const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } }); const p = await ctx.newPage();
  const errs = L.watchErrors(p);
  try {
    await L.post(s.url, "/game/live", { tempo: 0.4, voice: false, world_rules: "ever", ui: "glass" });
    await L.post(s.url, "/settings", { avatar: "portrait" });
    await p.goto(s.url + "/game?test"); await p.waitForTimeout(2500);
    await p.mouse.click(640, 400);
    let blank = 0, onSamples = 0, xs = [], ended = false, after = "", shownMax = 0, failedMax = 0;
    const log = await L.play(p, s.url, { secs: 240,
      every: async (st) => {
        if (st.screen === "on") { onSamples++; if ((await L.notBlank(p)) === false) blank++; }
        const w = await p.evaluate(() => ({ x: window.__pac.live.stat.portraitX })).catch(() => ({}));
        if (st.avatar === "portrait" && w.x != null) xs.push(w.x);
        const c = await p.evaluate(() => window.__pac.clock.stat).catch(() => null);
        if (c && !ended) { shownMax = Math.max(shownMax, c.shown); failedMax = Math.max(failedMax, c.failed); }
        if (st.event === "the end") ended = true; else if (ended && st.event) after = st.event;
      },
      until: () => ended && after });
    note(log.join(" · "));
    note(`world: ${shownMax} pictures shown, ${failedMax} failed`);
    check(shownMax >= 10, `the ever-changing world barely changed (${shownMax} pictures)`);
    check(errs.length === 0, "errors in the page:\n      " + errs.slice(0, 5).join("\n      "));
    check(ended, "the life never reached its end");
    check(after === "not started", `after the end it should wait for the die, not "${after}"`);
    check(onSamples > 20 && blank === 0, `the screen was blank ${blank} of ${onSamples} times`);
    check(xs.length > 10 && xs.every(x => Math.abs(x - 0.5) < 0.01), "the portrait didn't stand in the middle: " + xs.slice(0, 3).map(x => x.toFixed(3)));
  } finally { await b.close(); s.stop(); }
  done("a life");
})().catch(e => { console.log("FAIL a life\n   x " + e.stack); process.exit(1); });
