// The voice speaks one line at a time and nothing cuts it: a fake OpenAI session (no key here) that answers like the
// real one (created -> audio starts -> audio stops -> done, ~2.5 s a line). The Bookkeeper is driven the way the
// game drives it, and every message it sends is checked.
const L = require("../lib/standin.js"), { check, note, done } = require("../lib/check.js");
(async () => {
  const s = await L.standin({ life: "short" });
  const b = await L.browser();
  const v = await (await b.newContext()).newPage();
  const errs = L.watchErrors(v);
  try {
    await v.addInitScript(() => {
      window.__sent = []; window.__overlap = 0; let busy = false, n = 0;
      window.RTCPeerConnection = class {
        constructor() { this.connectionState = "connected"; }
        addTrack() {} async createOffer() { return { type: "offer", sdp: "v=0" }; } async setLocalDescription() {} async setRemoteDescription() {} close() {}
        createDataChannel() {
          const dc = { readyState: "open", close() {} };
          const emit = (ev) => setTimeout(() => dc.onmessage && dc.onmessage({ data: JSON.stringify(ev) }), 0);
          dc.send = (m) => {
            const ev = JSON.parse(m); window.__sent.push({ t: performance.now(), ...ev });
            if (ev.type === "response.create") {
              if (busy) { window.__overlap++; emit({ type: "error", error: { message: "Conversation already has an active response in progress" } }); return; }
              busy = true; const id = "r" + (++n);
              emit({ type: "response.created", response: { id } });
              setTimeout(() => emit({ type: "output_audio_buffer.started", response_id: id }), 300);
              setTimeout(() => { emit({ type: "response.output_audio_transcript.done", transcript: "line " + id }); emit({ type: "response.done", response: { id, status: "completed", output: [] } }); }, 900);
              setTimeout(() => { busy = false; emit({ type: "output_audio_buffer.stopped", response_id: id }); }, 2500);
            }
            if (ev.type === "response.cancel" || ev.type === "output_audio_buffer.clear") busy = false;
          };
          setTimeout(() => dc.onopen && dc.onopen(), 30);
          return dc;
        }
      };
    });
    await v.route("**/voice/token", (r) => r.fulfill({ json: { token: "fake", model: "m", voice: "cedar", speed: 1, max_wait_s: 18, player_can_talk: true,
      input: { noise_reduction: { type: "near_field" }, turn_detection: { type: "semantic_vad", eagerness: "low", create_response: false, interrupt_response: false } } } }));
    await v.route("https://api.openai.com/**", (r) => r.fulfill({ status: 200, body: "v=0" }));
    await v.goto(s.url + "/start");
    const r = await v.evaluate(async () => {
      const picked = [];
      const { createBookkeeper } = await import("/bookkeeper.js");
      const V = createBookkeeper({ onPick: (said) => { picked.push(said); return /old money/i.test(said) ? { ok: true, picked: "Old money" } : { ok: false }; } });
      V.setLive({ speed: 1, breath: 0, length: 1, moments: {} });
      const ok = await V.start("t");
      const T = () => performance.now();
      const kinds = () => window.__sent.map(m => m.type);
      const out = { ok };
      // 1. an arrival, then an outcome straight after: the outcome waits for the arrival to be heard out
      const t0 = T();
      const a = V.cue("[GAME] arrive\nthe years"); const o = V.cue("[GAME] outcome\nwhat happened");
      await a; out.arriveMs = T() - t0; await o; out.bothMs = T() - t0;
      out.cut1 = kinds().filter(k => k === "response.cancel" || k === "output_audio_buffer.clear").length;
      // 2. the cards rise (comment asked for) but the pick comes first: the stale comment is never spoken
      V.listen("open"); const busy = V.cue("[GAME] arrive\nthe next event");
      V.listen("pick"); const c = V.cue("[GAME] cards\nthe cards"); V.listen("closed");
      const nCreate = kinds().filter(k => k === "response.create").length;
      await busy; await c; await new Promise(r => setTimeout(r, 300));
      out.cardsSpoken = kinds().filter(k => k === "response.create").length - nCreate - 1;   // (minus the arrival's own)
      return out;
    });
    check(r.ok, "the faked voice session didn't start");
    note(`arrival heard out in ${(r.arriveMs / 1000).toFixed(1)} s, the outcome after it at ${(r.bothMs / 1000).toFixed(1)} s`);
    check(r.bothMs > r.arriveMs + 2000, "the outcome didn't wait for the arrival line to finish");
    check(r.cut1 === 0, `a line was cut (${r.cut1} cancel/clear sent)`);
    check(r.cardsSpoken === 0, `a stale comment on the cards was spoken after the pick (${r.cardsSpoken})`);
    // 3 (the player): driven through the fake data channel's transcription events
    const p = await v.evaluate(async () => {
      const picked = [];
      const { createBookkeeper } = await import("/bookkeeper.js?2");
      window.__sent.length = 0;
      let dcRef = null; const RT = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends RT { createDataChannel() { dcRef = super.createDataChannel(); return dcRef; } };
      const V = createBookkeeper({ onPick: (said) => { picked.push(said); return { ok: true, picked: said }; } });
      V.setLive({ speed: 1, breath: 0, length: 1, moments: {} });
      await V.start("t2");
      const hear = (t) => dcRef.onmessage({ data: JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: t }) });
      const creates = () => window.__sent.filter(m => m.type === "response.create").length;
      V.listen("open");
      for (const t of ["Thank you.", "Bye.", "you", "Hmm.", "Okay.", "Thanks for watching!"]) hear(t);
      await new Promise(r => setTimeout(r, 600));
      const afterNoise = creates(), whatNoise = V.stat.heardWhat;
      V.listen("pick"); hear("I'll take old money"); await new Promise(r => setTimeout(r, 600));
      const afterPick = creates(), whatPick = V.stat.heardWhat;
      V.listen("open"); hear("what is this game even about"); hear("and who are you anyway really"); await new Promise(r => setTimeout(r, 3500));
      const afterTalk = creates();
      // a game moment queued while it's answering: the answer is heard out, then the moment
      hear("one more question for you please"); const m = V.cue("[GAME] outcome\nsomething");
      await m; const cuts = window.__sent.filter(x => x.type === "response.cancel" || x.type === "output_audio_buffer.clear").length;
      // ITS OWN VOICE HEARD BACK: the mic is shut while it speaks (not while the cards are up), and its own words
      // coming back in are ignored, even naming a card; a real call still goes through
      const g = {};
      const speak = V.cue("[GAME] arrive\nx"); await new Promise(r => setTimeout(r, 500)); g.during = V.stat.micOpen;
      await speak; await new Promise(r => setTimeout(r, 900)); g.after = V.stat.micOpen;
      const emit = (ev) => dcRef.onmessage({ data: JSON.stringify(ev) });
      emit({ type: "response.output_audio_transcript.delta", delta: "Old money looks easy on paper, but silence has a cost." });
      emit({ type: "response.output_audio_transcript.done", transcript: "Old money looks easy on paper, but silence has a cost." });
      const nPicked = picked.length;
      V.listen("pick"); g.pickOpen = V.stat.micOpen;
      hear("old money looks easy on paper"); g.echoPicked = picked.length - nPicked; g.echoWhat = V.stat.heardWhat;
      hear("I want the artists one"); g.realPicked = picked.length - nPicked;
      V.listen("open");
      const before2 = creates(); hear("old money looks easy on paper but silence"); await new Promise(r => setTimeout(r, 300)); g.echoReplies = creates() - before2;
      // PAUSE: hush stops the line and drops what was queued
      const q1 = V.cue("[GAME] arrive\na"), q2 = V.cue("[GAME] outcome\nb");
      await new Promise(r => setTimeout(r, 500)); await V.hush(); await q1; await q2;
      const afterHush = window.__sent.filter(x => x.type === "response.cancel" || x.type === "output_audio_buffer.clear").length;
      return { afterNoise, afterPick, afterTalk, picked, cuts, afterHush, overlap: window.__overlap, whatNoise, whatPick, g };
    });
    check(p.afterNoise === 0, `noise got a reply (${p.afterNoise})`);
    check(/ignored/.test(p.whatNoise || "") && /picked/.test(p.whatPick || ""), `the panel isn't told what it did with what it heard: "${p.whatNoise}" / "${p.whatPick}"`);
    check(/old money/i.test(p.picked[0] || "") && p.afterPick === 0, `a card named during the cards: picked ${JSON.stringify(p.picked)}, replies ${p.afterPick}`);
    check(p.afterTalk === 1, `two real sentences in a row should get one answer, got ${p.afterTalk}`);
    check(p.cuts === 0, `a game moment cut the answer (${p.cuts} cancel/clear)`);
    check(p.afterHush > 0, "PAUSE didn't stop the line");
    check(p.g.during === false && p.g.after === true, `the mic wasn't shut while it spoke / opened after (during: ${p.g.during}, after: ${p.g.after})`);
    check(p.g.pickOpen === true, "the mic was shut while the cards were up (a card couldn't be called over its comment)");
    check(p.g.echoPicked === 0 && /own voice/.test(p.g.echoWhat || ""), `its own words, heard back, picked a card (${p.g.echoPicked}, "${p.g.echoWhat}")`);
    check(p.g.realPicked === 1, "a real call after its echo wasn't taken");
    check(p.g.echoReplies === 0, "it answered its own echo");
    check(p.overlap === 0, `a line was asked for while another was still being made (${p.overlap} times)`);
    check(errs.length === 0, "errors:\n      " + errs.slice(0, 5).join("\n      "));
  } finally { await b.close(); s.stop(); }
  done("voice (one line at a time, nothing cut, the room ignored)");
})().catch(e => { console.log("FAIL voice\n   x " + e.stack); process.exit(1); });
