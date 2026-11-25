// What goes wrong on a show day, on the stand-in: the server dies mid-life and comes back; pause and resume; the
// panel switches world rules mid-life; NEW LIFE. The page must carry on with no errors and never go blank.
const L = require("../lib/standin.js"), { check, note, done } = require("../lib/check.js");
(async () => {
  const s = await L.standin({ life: "short" });
  const b = await L.browser(); const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } }); const p = await ctx.newPage();
  const errs = L.watchErrors(p);
  const clock = () => p.evaluate(() => ({ ...window.__pac.clock.stat })).catch(() => ({}));
  try {
    await L.post(s.url, "/game/live", { tempo: 0.4, voice: false, world_rules: "ever" });
    await p.goto(s.url + "/game?test"); await p.waitForTimeout(2500); await p.mouse.click(640, 400);
    const at = {}; let blank = 0, samples = 0;
    const steps = [
      [20, "kill", async () => { s.kill(); }],
      [35, "back", async () => { await s.restart(); }],
      [55, "pause", async () => { at.paused = (await clock()).shown; await L.post(s.url, "/game/command", { cmd: "pause" }); }],
      [63, "resume", async () => { at.pausedEnd = (await clock()).shown; await L.post(s.url, "/game/command", { cmd: "resume" }); }],
      [70, "continuous", async () => { at.cont = (await clock()).shown; await L.post(s.url, "/game/live", { world_rules: "continuous" }); }],
      [82, "ever", async () => { at.contEnd = (await clock()).shown; await L.post(s.url, "/game/live", { world_rules: "ever" }); }],
      [100, "new life", async () => { at.newAt = (Date.now() - T0) / 1000; await L.post(s.url, "/game/command", { cmd: "new_life" }); }],
    ];
    const did = new Set(); let started = 0; const T0 = Date.now();
    await L.play(p, s.url, { secs: 150,
      every: async (st, el) => {
        if (!started && st.event && st.event !== "not started") started = el;
        if (started) for (const [t, name, f] of steps) if (!did.has(name) && el - started > t) { did.add(name); note(`${Math.round(el)}s ${name}`); await f(); }
        // (right after NEW LIFE the page reloads and is dark until the throw, by design: its last report still says "on")
        if (st.screen === "on" && !(at.newAt && el - at.newAt < 6)) { samples++; if ((await L.notBlank(p)) === false) { blank++; note(`blank at ${Math.round(el)}s: ${st.event} / ${st.turn} (after: ${[...did].pop() || "-"})`); } }
      },
      until: (st, el) => did.has("new life") && el - started > 120 });
    const after = await clock();
    note(`world clock after the drills: ${after.shown} shown, ${after.failed} failed, waiting: "${after.wait}"`);
    check(errs.length === 0, "errors in the page:\n      " + errs.slice(0, 5).join("\n      "));
    check(did.size === steps.length, "not every drill ran: " + [...did]);
    check(at.pausedEnd - at.paused <= 1, `pictures kept changing while paused (+${at.pausedEnd - at.paused})`);
    check(at.contEnd - at.cont <= 1, `the ever-changing clock kept showing in continuous mode (+${at.contEnd - at.cont})`);
    check(samples > 10 && blank === 0, `the screen went blank ${blank} of ${samples} times`);
    const st = await (await fetch(s.url + "/game/state")).json();
    check(st.seconds_ago != null && st.seconds_ago < 5, "the game stopped reporting after the drills");
  } finally { await b.close(); s.stop(); }
  done("drills (server dies, pause, switches, new life)");
})().catch(e => { console.log("FAIL drills\n   x " + e.stack); process.exit(1); });
