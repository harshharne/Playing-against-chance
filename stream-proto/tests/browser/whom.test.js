// Whom (the household) is painted by the picture model like any other event: no drawing over it, no avatar yet,
// and the pictures asked for are the household's home. Where (the map) before it and the baby after it still work.
const L = require("../lib/standin.js"), { check, note, done } = require("../lib/check.js");
(async () => {
  process.env.SHORT_KEEP = "where,whom,body,death";
  const s = await L.standin({ life: "short" });
  const b = await L.browser();
  const g = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errs = L.watchErrors(g);
  const asked = [];                                       // every world picture the game asks for, with the event it was in
  let ev = "";
  g.on("request", (r) => { if (r.url().includes("/world") && r.method() === "POST") { try { asked.push({ ev, prompt: (r.postDataJSON() || {}).prompt || "" }); } catch (e) {} } });
  const seen = { whom: 0, whomScene: [], whomPortrait: 0, whomBlank: 0, baby: false };
  try {
    await L.post(s.url, "/game/live", { voice: false });
    await g.goto(s.url + "/game?test"); await g.waitForTimeout(2000);
    const log = await L.play(g, s.url, { secs: 240, until: (st) => st.event === "death" || (st.event || "").toLowerCase().includes("death"),
      every: async (st) => {
        ev = st.event || ev;
        if (/whom/i.test(st.event || "")) {
          seen.whom++;
          const x = await g.evaluate(() => ({ canvas: !!document.getElementById("house"), portrait: window.__pac.live.avatarMode && window.__pac.live.stat.portraitX })).catch(() => ({}));
          if (x.canvas) seen.whomScene.push("house canvas");
          if (x.portrait) seen.whomPortrait++;
          if ((await L.notBlank(g)) === false) seen.whomBlank++;
          if (seen.whom === 6) await g.screenshot({ path: "/tmp/whom.png" });
        }
        if (/body/i.test(st.event || "")) seen.baby = true;
      } });
    note(log.join(" · "));
    const inWhom = asked.filter((a) => /whom/i.test(a.ev));
    note(`pictures asked for in Whom: ${inWhom.length}` + (inWhom[0] ? ` (e.g. "${inWhom[0].prompt.slice(0, 120)}")` : ""));
    check(seen.whom > 3, "the life never reached Whom");
    check(seen.whomScene.length === 0, "the house drawing is still there");
    check(inWhom.length >= 2, "Whom wasn't painted (no pictures asked for during it)");
    check(seen.whomPortrait === 0, "an avatar showed during Whom (before the baby)");
    check(seen.whomBlank === 0, `the screen was blank ${seen.whomBlank} times during Whom`);
    check(seen.baby, "the life never reached the baby after Whom");
    check(errs.length === 0, "errors:\n      " + errs.slice(0, 5).join("\n      "));
  } finally { await b.close(); s.stop(); }
  done("whom (painted, not drawn)");
})().catch(e => { console.log("FAIL whom\n   x " + e.stack); process.exit(1); });
