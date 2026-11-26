// BACK on /panel: the previous event plays again, with the life as it stood then. On the short life (body, school,
// exams, umbrella, death): at exams, go back -> school plays again, the ledger holds only what came before school, the
// baby is there for the takeover; then the life plays to its end with each event in the ledger once and no errors.
const L = require("../lib/standin.js"), { check, note, done } = require("../lib/check.js");
(async () => {
  const s = await L.standin({ life: "short" });
  const b = await L.browser(); const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } }); const p = await ctx.newPage();
  const errs = L.watchErrors(p);
  const life = () => p.evaluate(() => window.__pac && window.__pac.life()).catch(() => null);
  try {
    await L.post(s.url, "/game/live", { tempo: 0.4, voice: false, world_rules: "ever" });
    await p.goto(s.url + "/game?test"); await p.waitForTimeout(2500); await p.mouse.click(640, 400);
    let before = null, after = null, sentAt = 0, end = null, seen = [];
    await L.play(p, s.url, { secs: 360,
      every: async (st, el) => {
        if (st.event && seen[seen.length - 1] !== st.event) seen.push(st.event);
        if (!sentAt && st.event === "The exams") {
          before = await life(); note(`at exams: ledger [${before && before.ledger}]`);
          sentAt = el; await L.post(s.url, "/game/command", { cmd: "back" });
        } else if (sentAt && !after && el - sentAt > 3 && st.event === "The school year") {
          const l = await life();
          if (l && l.evIdx >= 0) { after = { ...l, event: st.event }; note(`after back: ${st.event}, ledger [${l.ledger}], baby ${l.baby}`); }
        }
        if (sentAt) { const l = await life(); if (l && l.ended) end = l; }
      },
      until: () => end && end.ledger.length >= 4 });
    note("events seen: " + seen.join(" > "));
    check(before && before.ledger.length >= 2, "never reached exams with school in the ledger");
    check(after && after.evIdx === 1, `back didn't return to school (evIdx ${after && after.evIdx})`);
    check(after && after.ledger.length === before.ledger.length - 1, `the ledger wasn't put back: [${after && after.ledger}] vs [${before && before.ledger}]`);
    check(after && after.baby, "the baby wasn't there for the takeover");
    check(end, "the life didn't reach its end after going back");
    if (end) { const dup = end.ledger.filter((t, i) => end.ledger.indexOf(t) !== i); check(!dup.length, "events in the ledger twice: " + dup); }
    check(errs.length === 0, "errors in the page:\n      " + errs.slice(0, 5).join("\n      "));
  } finally { await b.close(); s.stop(); }
  done("back (the previous event again)");
})().catch(e => { console.log("FAIL back\n   x " + e.stack); process.exit(1); });
