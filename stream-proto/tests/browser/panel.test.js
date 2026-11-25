// The panel: it loads with no errors, and its switches reach the server (world rules, heritage, tempo).
const L = require("../lib/standin.js"), { check, done } = require("../lib/check.js");
(async () => {
  const s = await L.standin({ life: "short" });
  const b = await L.browser(); const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = L.watchErrors(p);
  const live = async () => ((await (await fetch(s.url + "/game/state")).json()).live) || {};
  const cfg = async () => (await fetch(s.url + "/config")).json();
  try {
    await p.goto(s.url + "/panel"); await p.waitForTimeout(2000);
    await p.click('button[data-t="world"]'); await p.waitForTimeout(500);
    for (const v of ["continuous", "ever"]) { await p.click(`#s_rules button[data-v="${v}"]`); await p.waitForTimeout(900); check((await live()).world_rules === v, `WORLD RULES ${v} didn't reach the game`); }
    await p.click('button[data-t="avatar"]').catch(() => {});
    await p.$eval("#heritage", (e) => { e.value = "0.8"; e.dispatchEvent(new Event("input")); }); await p.waitForTimeout(900);
    check(Math.abs((await live()).heritage - 0.8) < 0.01, "HERITAGE didn't reach the game");
    await p.$eval("#tempo", (e) => { e.value = "1.3"; e.dispatchEvent(new Event("input")); }); await p.waitForTimeout(900);
    check(Math.abs((await live()).tempo - 1.3) < 0.01, "TEMPO didn't reach the game");
    for (const page of ["/start", "/shots.html", "/sound-lab.html"]) {
      const q = await b.newPage(); const e2 = L.watchErrors(q); await q.goto(s.url + page); await q.waitForTimeout(1200);
      check(e2.length === 0, `${page} has errors: ${e2[0]}`); await q.close();
    }
    check(errs.length === 0, "errors in the panel: " + errs.slice(0, 3).join(" | "));
  } finally { await b.close(); s.stop(); }
  done("panel");
})().catch(e => { console.log("FAIL panel\n   x " + e.stack); process.exit(1); });
