// The panel runs the game LIVE: every switch and slider that says it changes the game at once is moved on /panel
// while a game page is open, and the game page itself is checked (not just the server) within a few seconds.
const L = require("../lib/standin.js"), { check, note, done } = require("../lib/check.js");
(async () => {
  const s = await L.standin({ life: "short", slow: +process.env.SLOW || 1 });
  const b = await L.browser();
  // one browser profile for both, as on the Mac (Chrome allows 6 connections to one server, shared by every tab)
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const g = await ctx.newPage(), p = await ctx.newPage();
  const errs = L.watchErrors(g), perrs = L.watchErrors(p);
  const game = () => g.evaluate(() => ({ ...window.__pac.panel(), cfg: window.__pac.live._cfg() }));
  // wait up to ms for the game to show it (the game reads the panel every 0.6 s, the server's settings every 1 s)
  async function sees(what, ok, ms = 4000) {
    const t0 = Date.now(); let st = null;
    while (Date.now() - t0 < ms) { try { st = await game(); if (ok(st)) { note(`${what}: ${((Date.now() - t0) / 1000).toFixed(1)} s`); return true; } } catch (e) {} await g.waitForTimeout(200); }
    check(false, `${what} didn't reach the game page (it has: ${JSON.stringify(st && (st.cfg || st)).slice(0, 300)})`); return false;
  }
  const tab = (t) => p.click(`button[data-t="${t}"]`).catch(() => {});
  const seg = (id, v) => p.click(`#${id} button[data-v="${v}"]`);
  const slide = (id, v) => p.$eval("#" + id, (e, v) => { e.value = String(v); e.dispatchEvent(new Event("input", { bubbles: true })); }, v);
  try {
    await L.post(s.url, "/game/live", { voice: false, ui: "glass", tempo: 1 });
    await g.goto(s.url + "/game?test"); await g.waitForTimeout(2500);
    await p.goto(s.url + "/panel"); await p.waitForTimeout(2000);
    // a visitor plays meanwhile, so the page is busy the way it is at the venue (pictures being painted, frames sent)
    let playing = true; const busy = L.play(g, s.url, { secs: 600, until: () => !playing }).catch(() => {});
    await g.waitForTimeout(+process.env.SLOW > 1 ? 15000 : 4000);

    // the top of the panel (always visible)
    await seg("s_ui", "fog");      await sees("STYLE fog", (x) => x.ui === "fog");
    await seg("s_ui", "glass");    await sees("STYLE glass", (x) => x.ui === "glass");
    await seg("s_rules", "continuous").catch(async () => { await tab("world"); await seg("s_rules", "continuous"); });
    await sees("WORLD RULES continuous", (x) => x.rules === "continuous");
    await seg("s_rules", "ever");  await sees("WORLD RULES ever", (x) => x.rules === "ever");
    await tab("pace");
    await slide("tempo", 1.35);    await sees("TEMPO", (x) => Math.abs(x.tempo - 1.35) < 0.01);
    await slide("type_scale", 1.2); await sees("TYPE SIZE", (x) => Math.abs(+x.ts - 1.2) < 0.01);
    await seg("s_subs", "on");     await sees("WORDS on screen", (x) => x.bk.subs === "on");
    await seg("s_sound", "off");   await sees("SOUND off", (x) => x.sound.on === false);
    await seg("s_sound", "on");    await sees("SOUND on", (x) => x.sound.on !== false);
    await seg("s_voice", "off");   await sees("VOICE off", (x) => x.voiceOn === false);

    // the server's settings (the world and the avatar): the game reads them from /config
    await tab("world");
    await slide("move", 0.8);      await sees("MOVE", (x) => Math.abs(x.cfg.move - 0.8) < 0.01);
    await slide("parallax", 0.05); await sees("PARALLAX", (x) => Math.abs(x.cfg.parallax - 0.05) < 0.001);
    await slide("dissolve", 0.2);  await sees("DISSOLVE", (x) => Math.abs(x.cfg.dissolve - 0.2) < 0.01);
    await tab("avatar");
    await seg("s_avatar", "portrait"); await sees("AVATAR portrait", (x) => x.cfg.avatar === "portrait");
    await slide("heritage", 0.9);  await sees("HERITAGE", (x) => Math.abs(x.heritage - 0.9) < 0.01);

    // the two typefaces
    await p.waitForTimeout(500);
    const faces = await p.$$eval("#font_event option", (o) => o.map((x) => x.value));
    const pickE = faces.find((f) => f !== "noto-serif-display") || faces[0];
    await p.selectOption("#font_event", pickE);
    await sees(`EVENT FONT ${pickE}`, (x) => x.fonts[0] === pickE && x.fontVar.length > 0);

    // the voice, as it sounds (applies at once)
    await tab("voice");
    await slide("v_speed", 1.2);   await sees("VOICE SPEED", (x) => Math.abs(x.bk.speed - 1.2) < 0.01);
    await slide("v_volume", 0.4);  await sees("VOICE VOLUME", (x) => Math.abs(x.bk.volume - 0.4) < 0.01 && Math.abs(x.bk.volume_now - 0.4) < 0.01);
    await slide("v_breath", 1.5);  await sees("VOICE BREATH", (x) => Math.abs(x.bk.breath - 1.5) < 0.01);
    await slide("v_length", 0.6);  await sees("LINE LENGTH", (x) => Math.abs(x.bk.length - 0.6) < 0.01);
    await seg("v_mic", "far");     await sees("MICROPHONE room", (x) => x.bk.mic === "far");
    await seg("v_listen", "medium"); await sees("WAITS FOR THE PLAYER", (x) => x.bk.listen === "medium");

    // ... and they reach a RUNNING voice session (OpenAI faked: no key here). The real session is started with
    // what the panel says, then every change goes to it as a session.update, without a new life.
    const v = await ctx.newPage();
    await v.addInitScript(() => {
      window.__sent = [];
      window.RTCPeerConnection = class {
        constructor() { this.connectionState = "connected"; }
        addTrack() {} createDataChannel() { const dc = { readyState: "open", send: (m) => window.__sent.push(JSON.parse(m)), close() {} }; setTimeout(() => dc.onopen && dc.onopen(), 50); return dc; }
        async createOffer() { return { type: "offer", sdp: "v=0" }; } async setLocalDescription() {} async setRemoteDescription() {} close() {}
      };
    });
    const input = { noise_reduction: { type: "near_field" }, transcription: { model: "gpt-4o-mini-transcribe" },
                    turn_detection: { type: "semantic_vad", eagerness: "low", create_response: false, interrupt_response: false } };
    await v.route("**/voice/token", (r) => r.fulfill({ json: { token: "fake", model: "m", voice: "cedar", speed: 1, input, mic_default: "near_field", listen_default: "low" } }));
    await v.route("https://api.openai.com/**", (r) => r.fulfill({ status: 200, body: "v=0" }));
    await v.goto(s.url + "/start");
    const sent = await v.evaluate(async () => {
      const { createBookkeeper } = await import("/bookkeeper.js");
      const V = createBookkeeper(); const ok = await V.start("t");
      const n0 = window.__sent.length;
      V.setLive({ mic: "far", listen: "high" }); V.setLive({ mic: "far", listen: "high" });   // the same twice: sent once
      const a = window.__sent.slice(n0);
      V.setLive({ mic: "", listen: "" });                                                      // back to "as set"
      const b = window.__sent.slice(n0 + a.length);
      return { ok, a, b };
    });
    check(sent.ok, "the faked voice session didn't start");
    const up = (m) => m && m.type === "session.update" && m.session && m.session.audio && m.session.audio.input;
    check(sent.a.length === 1 && up(sent.a[0]) && up(sent.a[0]).noise_reduction.type === "far_field" && up(sent.a[0]).turn_detection.eagerness === "high"
          && up(sent.a[0]).transcription && up(sent.a[0]).turn_detection.create_response === false,
          "MICROPHONE / WAITS didn't go to the running session as one session.update: " + JSON.stringify(sent.a).slice(0, 400));
    check(sent.b.length === 1 && up(sent.b[0]) && up(sent.b[0]).noise_reduction.type === "near_field" && up(sent.b[0]).turn_detection.eagerness === "low",
          "AS SET didn't go back to bookkeeper.json's mic and waiting: " + JSON.stringify(sent.b).slice(0, 400));
    if (sent.a.length === 1) note("the running voice session gets: " + JSON.stringify(up(sent.a[0])));
    await v.close();

    // the sound mix
    await tab("sound");
    await slide("snd_bed", -20);   await sees("SOUND BED", (x) => x.sound.bed === -20);
    await slide("snd_master", -6); await sees("SOUND EVERYTHING", (x) => x.sound.master === -6);

    // the game page reloads (NEW LIFE): it comes back with the panel's settings, not the defaults
    await L.post(s.url, "/game/command", { cmd: "new_life" }); await g.waitForTimeout(3500);
    await sees("after a reload: everything still as set", (x) => Math.abs(x.tempo - 1.35) < 0.01 && Math.abs(x.bk.speed - 1.2) < 0.01 && x.sound.bed === -20 && x.fonts[0] === pickE, 6000);

    playing = false; await busy;
    check(errs.length === 0, "errors in the game:\n      " + errs.slice(0, 5).join("\n      "));
    check(perrs.length === 0, "errors in the panel:\n      " + perrs.slice(0, 5).join("\n      "));
  } finally { await b.close(); s.stop(); }
  done("live (the panel changes the game as it runs)");
})().catch(e => { console.log("FAIL live\n   x " + e.stack); process.exit(1); });
