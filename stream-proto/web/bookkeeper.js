// ============================================================================
//  The Bookkeeper: the voice in the room. OpenAI Realtime over WebRTC, speech to speech.
//
//    const V = createBookkeeper({ onPick })
//    await V.start(lifeId)          // a new session for each life (GET /voice/token mints its key on the server)
//    await V.cue(text)              // a [GAME] moment: it answers out loud; resolves when it has finished speaking
//                                   // (or after max_wait_s), at once when there's no voice
//    V.listen("open" | "pick" | "closed")   // may it answer the player? "pick": and choose a card by voice
//    V.hush()                       // stop talking now (the throw is coming)
//    V.stop()                       // end the session
//    V.on, V.showText, V.stat       // connected? keep the text boxes too? state for the debug line
//    V.setSubtitles("" | "on" | "off")   // the panel: the words on screen too, or not ("" = bookkeeper.json)
//    V.setLive({speed, volume, length, breath, moments, talk_back})   // the panel's Voice tab, applied at once
//
//  The game decides WHEN it speaks: the session never answers by itself (create_response off), the game asks for
//  every answer. The player is heard all the time; it answers them only when the game lets it (listen).
//  onPick(name) -> {ok, picked} | {ok: false, reason}: the player chose a card by voice (the choose_card tool).
// ============================================================================
export function createBookkeeper({ onPick = () => ({ ok: false, reason: "the cards aren't up" }), context = () => "" } = {}) {
  // context(): the game's record of the life so far, for a voice that had to reconnect mid-life
  const stat = { state: "off", note: "", said: 0, heard: 0, last: "" };
  let pc = null, dc = null, mic = null, cfg = null, life = "", session = 0, subs = "";   // subs: the panel's SUBTITLES ("" / "on" / "off")
  // the panel's Voice tab, live: how fast, how loud, how long its lines, a breath before each, which moments it speaks at
  const P = { speed: 1, volume: 1, length: 1, breath: 0.4, moments: {}, talk_back: true, mic: "", listen: "" };
  let speedSent = 1;                                           // the speed the session has now (it changes between lines only)
  const BUDGET = { arrive: 22, cards: 14, outcome: 20, happened: 20, fluke: 12, close: 40 };   // words, as bookkeeper.md has them (a life in ~10 min)
  const GROUP = { arrive: "arrive", cards: "cards", outcome: "outcome", happened: "outcome", fluke: "fluke", close: "close" };
  const audio = Object.assign(document.createElement("audio"), { autoplay: true });
  audio.setAttribute("aria-hidden", "true");
  document.body.appendChild(audio);

  // one waiter per answer asked for: resolved when its sound has finished (or it was cut, or it took too long)
  const asked = [];                          // asked for, not yet created by the server (FIFO)
  const byId = new Map();                    // response id -> waiter
  let generating = 0, speaking = false, listening = "closed";
  // ONE LINE AT A TIME: every line waits for the one before it to be heard out. Nothing cuts a line but PAUSE or a new
  // life (hush / stop). The game awaits each cue, so the next moment waits for the voice too.
  let turn = Promise.resolve(), epoch = 0, cueSeq = 0, lastAnswer = 0;
  // ITS OWN VOICE, HEARD BACK: the speakers are in the room with the mic, so what it says comes back in. While it
  // speaks the mic is shut (it can't be interrupted anyway), and for a moment after (the room's echo), except while
  // the cards are up (a card can be called over its comment). And anything heard that is mostly its own recent words
  // is its echo, not the player: ignored (or its comment naming a card would pick that card).
  let gateT = 0, stoppedAt = 0, startedInVoice = false;
  const said = [];                                            // [time, words] of its last lines
  function gate(open) { const tr = mic && mic.getAudioTracks()[0]; if (tr) tr.enabled = open; stat.micOpen = open; }
  const wordsOf = (x) => String(x || "").toLowerCase().replace(/[’']/g, "").match(/[a-z]{3,}/g) || [];
  let cur = null;                                             // the line being spoken now: its words, as they come
  function remember(text) {
    if (!cur) { cur = [Date.now(), new Set()]; said.push(cur); while (said.length > 8) said.shift(); }
    cur[0] = Date.now(); for (const w of wordsOf(text)) cur[1].add(w);
  }
  function isEcho(t) {
    const ws = wordsOf(t); if (!ws.length) return false;
    const recent = new Set(); for (const [at, w] of said) if (Date.now() - at < 30000) for (const x of w) recent.add(x);
    const frac = ws.filter(w => recent.has(w)).length / ws.length;
    return ws.length >= 3 ? frac >= 0.6 : startedInVoice && frac === 1;   // (a short call over its voice that only repeats it: echo)
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const idle = () => !generating && !speaking;
  async function waitIdle(maxMs) { const t0 = Date.now(); while (!idle() && Date.now() - t0 < maxMs) await sleep(80); }
  function enqueue(job) { const p = turn.then(job, job); turn = p.catch(() => {}); return p; }

  const send = (ev) => { if (dc && dc.readyState === "open") dc.send(JSON.stringify(ev)); };
  const log = (who, text) => {
    if (!text) return;
    fetch("/voice/log", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ life, version: cfg && cfg.version, who, text }) }).catch(() => {});
  };
  function finish(w) { if (!w || w.done) return; w.done = true; clearTimeout(w.timer); w.resolve(); }
  function finishAll() { asked.splice(0).forEach(finish); for (const w of byId.values()) finish(w); byId.clear(); }

  // ---------- sound: Chrome may block it until someone clicks or presses a key ----------
  function unlock() { audio.play().then(() => { if (stat.note.startsWith("sound")) stat.note = ""; }).catch(() => {}); }
  addEventListener("pointerdown", unlock); addEventListener("keydown", unlock);

  // ---------- a life's session ----------
  // LOST MID-LIFE (the network, OpenAI dropping the call): it comes back by itself, told the life so far. A
  // "disconnected" call often recovers on its own: it gets 5 s first. At most 4 tries a life, further apart each time.
  let tries = 0, retryT = 0;
  function lost(mine, why) {
    if (mine !== session) return;
    stat.state = "lost"; stat.note = "connection " + why; finishAll();
    if (tries >= 4) { stat.note += " (gave up for this life)"; return; }
    const wait = [2000, 5000, 10000, 20000][tries++];
    stat.note += ` · reconnecting in ${wait / 1000} s`;
    clearTimeout(retryT);
    retryT = setTimeout(() => { if (mine === session) start(life, { resume: true }); }, wait);
  }
  async function start(lifeId = "", { resume = false } = {}) {
    const was = listening;
    stop();
    if (!resume) { tries = 0; clearTimeout(retryT); }
    const mine = ++session;
    life = String(lifeId); stat.state = resume ? "reconnecting" : "connecting"; if (!resume) stat.note = "";
    try {
      const t = await (await fetch("/voice/token", { cache: "no-store" })).json();
      if (!t.token) throw new Error(t.error || "no voice key");
      cfg = t;
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (mine !== session) { mic.getTracks().forEach(x => x.stop()); return false; }
      pc = new RTCPeerConnection();
      pc.ontrack = (e) => { audio.srcObject = e.streams[0]; audio.play().catch(() => { stat.note = "sound blocked: click or press a key once"; }); };
      pc.addTrack(mic.getAudioTracks()[0], mic);
      pc.onconnectionstatechange = () => {
        const st = pc && pc.connectionState;
        if (mine !== session || stat.state === "connecting" || stat.state === "reconnecting") return;
        if (st === "failed" || st === "closed") lost(mine, st);
        else if (st === "disconnected") setTimeout(() => { if (mine === session && pc && pc.connectionState !== "connected") lost(mine, "disconnected"); }, 5000);
      };
      dc = pc.createDataChannel("oai-events");
      dc.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch (err) { console.warn("[voice]", err); } };
      const opened = new Promise((res, rej) => { dc.onopen = res; setTimeout(() => rej(new Error("no answer from OpenAI")), 10000); });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const r = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST", body: offer.sdp, headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/sdp" } });
      if (!r.ok) throw new Error(`OpenAI said ${r.status}: ${(await r.text()).slice(0, 160)}`);
      await pc.setRemoteDescription({ type: "answer", sdp: await r.text() });
      await opened;
      if (mine !== session) return false;
      stat.state = "ready"; speedSent = cfg.speed || 1;
      if (!resume) stat.said = stat.heard = 0;
      inputSent = JSON.stringify(cfg.input || {}); applyInput();   // (the panel may have changed while it connected)
      if (resume) {                                               // back mid-life: it's told the life so far, then carries on
        const rec = String(context() || "");
        if (rec) send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: rec }] } });
        listening = was; stat.note = "reconnected"; log("game", "(the voice reconnected mid-life)");
      }
      return true;
    } catch (e) {
      if (mine === session) {
        stop(); stat.state = "off"; stat.note = String(e.message || e).slice(0, 180);
        if (resume) { const m = session; lost(m, "failed again"); }   // (try again, while there are tries left)
      }
      console.warn("[voice] no voice this life:", e);
      return false;
    }
  }
  function stop() {
    session++; clearTimeout(retryT);
    finishAll();
    try { dc && dc.close(); } catch (e) {}
    try { pc && pc.close(); } catch (e) {}
    if (mic) mic.getTracks().forEach(x => x.stop());
    pc = dc = mic = null; generating = 0; speaking = false; listening = "closed"; epoch++;
    if (stat.state !== "off") stat.state = "off";
  }
  const on = () => stat.state === "ready" && !!dc && dc.readyState === "open";

  // ---------- what the server says ----------
  function handle(ev) {
    switch (ev.type) {
      case "response.created": {
        const w = asked.shift();
        if (w) byId.set(ev.response.id, w);
        dispatchEvent(new CustomEvent("pac-voice", { detail: { speaking: true } }));   // the sound makes room before the first word
        break;
      }
      case "output_audio_buffer.started":
        speaking = true; clearTimeout(gateT);
        if (listening !== "pick") gate(false);                  // (its own voice mustn't come back in as the player's)
        dispatchEvent(new CustomEvent("pac-voice", { detail: { speaking: true } }));   // (the game's sound ducks under it)
        { const w = byId.get(ev.response_id); if (w) w.audio = true; }
        break;
      case "output_audio_buffer.stopped":
        speaking = false; stoppedAt = Date.now(); clearTimeout(gateT); gateT = setTimeout(() => gate(true), 700);
        dispatchEvent(new CustomEvent("pac-voice", { detail: { speaking: false } }));   // (the game's sound ducks under it)
        finish(byId.get(ev.response_id)); byId.delete(ev.response_id);
        break;
      case "output_audio_buffer.cleared":
        speaking = false; stoppedAt = Date.now(); clearTimeout(gateT); gateT = setTimeout(() => gate(true), 700);
        dispatchEvent(new CustomEvent("pac-voice", { detail: { speaking: false } }));   // (the game's sound ducks under it)
        for (const w of byId.values()) finish(w);
        byId.clear();
        break;
      case "response.done": {
        generating = Math.max(0, generating - 1);
        if (!speaking) dispatchEvent(new CustomEvent("pac-voice", { detail: { speaking: false } }));   // (nothing was said)
        const resp = ev.response || {}, w = byId.get(resp.id);
        for (const item of resp.output || []) if (item.type === "function_call") toolCall(item);
        if (resp.status && resp.status !== "completed") { finish(w); byId.delete(resp.id); }
        else if (w && !w.audio) setTimeout(() => { if (!w.audio) { finish(w); byId.delete(resp.id); } }, 700);   // nothing to hear (a tool call only)
        break;
      }
      case "response.output_audio_transcript.done":
        stat.said++; stat.last = ev.transcript || ""; log("bookkeeper", ev.transcript); remember(ev.transcript); cur = null;
        break;
      case "response.output_audio_transcript.delta":
        if (ev.delta) remember(ev.delta);                       // (its words are known before the echo of them comes back)
        break;
      case "input_audio_buffer.speech_started":
        startedInVoice = speaking || Date.now() - stoppedAt < 1000;
        break;
      case "conversation.item.input_audio_transcription.completed":
        heard(ev.transcript || "");
        break;
      case "error":
        stat.note = (ev.error && ev.error.message || "error").slice(0, 180);
        console.warn("[voice] error:", ev.error);
        if (ev.error && /response/i.test(ev.error.message || "") && generating) { generating--; finish(asked.shift()); }
        break;
    }
  }

  // ---------- the player ----------
  // What the mic hears is mostly the room: the game's own sound, people talking to each other, and the transcriber's
  // inventions on noise ("Thank you.", "Bye."). So: a card named while the cards are up is taken (by the game, no
  // reply); anything else is answered only if it's a real sentence, at most once every 25 s, after the current line,
  // and never instead of the game's next moment. Nothing that isn't understood gets a reply (no "say it again").
  const NOISE = /^(thank you|thanks|thanks for watching|thank you for watching|you|bye|bye bye|okay|ok|hmm+|uh+|um+|yeah|yes|no|oh|ah|so|right|wow|hello|hi)[.!?]*$/i;
  function heard(text) {
    const t = String(text || "").trim();
    const what = (w) => { stat.heardLast = t.slice(0, 120); stat.heardWhat = w; };   // (shown on /panel: what it did with it)
    if (!/[a-z]{2}/i.test(t) || NOISE.test(t)) { if (t) what("ignored: noise, or the transcriber guessing"); return; }
    if (isEcho(t)) { log("game", `heard its own voice back: ${t}`); return what("ignored: its own voice, heard back"); }
    stat.heard++; log("player", t);
    if (listening === "pick") {                                // a card named: the game takes it (no reply needed)
      const r = onPick(t) || {};
      log("game", `heard during the cards -> ${r.ok ? "picked " + r.picked : "no card named"}`);
      what(r.ok ? `picked: ${r.picked}` : "the cards are up and no card was named: no reply");
      return;
    }
    if (!cfg || !cfg.player_can_talk || !P.talk_back) return what("not answered: talking back is off");
    if (listening !== "open") return what("not answered: the die is being thrown / the game is mid-moment");
    if (t.split(/\s+/).length < 3) return what("not answered: under 3 words");
    if (Date.now() - lastAnswer < 25000) return what("not answered: it answered someone less than 25 s ago");
    lastAnswer = Date.now();
    what("answering (after the current line)");
    const mine = cueSeq, e = epoch;
    enqueue(async () => {
      await waitIdle(30000);
      if (e !== epoch || mine !== cueSeq || listening !== "open" || !on()) return what("not answered: the game's next moment came first");
      await speakNow("none", 15000);
    });
  }
  function toolCall(item) {
    let res = { ok: false, reason: "not now" };
    if (item.name === "choose_card") {
      let card = "";
      try { card = JSON.parse(item.arguments || "{}").card || ""; } catch (e) {}
      res = listening === "pick" ? (onPick(card) || res) : { ok: false, reason: "the cards aren't up now" };
      log("game", `choose_card(${card}) -> ${JSON.stringify(res)}`);
    }
    send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: item.call_id, output: JSON.stringify(res) } });
    // (no reply either way: a wrong name gets silence, not a lecture)
  }

  // ---------- asking it to speak ----------
  function speakNow(toolChoice, maxMs) {
    if (Math.abs(P.speed - speedSent) > 0.001) {               // a new speed: between lines is the only time it can change
      send({ type: "session.update", session: { type: "realtime", audio: { output: { speed: P.speed } } } });
      speedSent = P.speed;
    }
    return new Promise(resolve => {
      const w = { resolve, done: false, audio: false };
      w.timer = setTimeout(() => finish(w), maxMs ?? ((cfg && cfg.max_wait_s) || 18) * 1000);
      asked.push(w); generating++;
      send({ type: "response.create", response: { tool_choice: toolChoice } });
    });
  }
  async function hush() {                                     // PAUSE / a new life only: stops the line and drops the queue
    epoch++;
    if (!on()) return;
    if (generating) send({ type: "response.cancel" });
    if (speaking || generating) send({ type: "output_audio_buffer.clear" });
    finishAll();
    for (let i = 0; i < 20 && generating; i++) await new Promise(r => setTimeout(r, 50));   // let the cancel land
    generating = 0; speaking = false;
  }
  async function cue(text) {
    if (!on()) return;
    const moment = (text.match(/^\[GAME\] (\w+)/) || [])[1] || "", group = GROUP[moment];
    if (group && P.moments[group] === false) {                 // switched off on the panel: it learns what happened, silently
      send({ type: "conversation.item.create", item: { type: "message", role: "user",
        content: [{ type: "input_text", text: text.replace(/^\[GAME\] /, "[GAME] record: ") }] } });
      log("game", "(silent) " + text);
      return;
    }
    if (BUDGET[moment] && Math.abs(P.length - 1) > 0.01) text += `\nlength: at most ${Math.max(6, Math.round(BUDGET[moment] * P.length))} words`;
    const mine = ++cueSeq, e = epoch;
    log("game", text);
    return enqueue(async () => {
      await waitIdle(30000);                                   // the line before is heard out first
      if (e !== epoch || !on()) return;
      if (moment === "cards" && (listening !== "pick" || mine !== cueSeq)) return;   // the pick is made: a comment on the cards is stale
      send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
      if (P.breath > 0) await sleep(P.breath * 1000);          // a beat before it speaks
      if (e !== epoch || !on()) return;
      const words = BUDGET[moment] ? BUDGET[moment] * P.length : 40;
      await speakNow("none", Math.max(15000, (words / 2.2 / Math.max(0.5, P.speed) + 8) * 1000));   // long enough for the whole line
    });
  }
  function setLive(b) {
    if (!b || typeof b !== "object") return;
    for (const k of ["speed", "volume", "length", "breath"]) if (Number.isFinite(+b[k])) P[k] = +b[k];
    if (b.moments && typeof b.moments === "object") P.moments = { ...b.moments };
    if (typeof b.talk_back === "boolean") P.talk_back = b.talk_back;
    P.mic = ["near", "far"].includes(b.mic) ? b.mic : "";                       // MICROPHONE: laptop / room ("" = as set)
    P.listen = ["low", "medium", "high"].includes(b.listen) ? b.listen : "";     // WAITS FOR THE PLAYER
    audio.volume = Math.max(0, Math.min(1, P.volume));
    applyInput();
  }
  // the mic's filtering and how long it waits for the player: changed in the running session (no new life needed)
  let inputSent = "";
  function inputWanted() {
    if (!cfg || !cfg.input) return null;
    const input = JSON.parse(JSON.stringify(cfg.input));
    input.noise_reduction = { type: P.mic ? P.mic + "_field" : cfg.mic_default || "near_field" };
    if (input.turn_detection) input.turn_detection.eagerness = P.listen || cfg.listen_default || "low";
    return input;
  }
  function applyInput() {
    const input = inputWanted();
    if (!input || !on()) return;
    const key = JSON.stringify(input);
    if (key === inputSent) return;
    inputSent = key;
    send({ type: "session.update", session: { type: "realtime", audio: { input } } });
    log("game", `(listening: ${input.noise_reduction.type}, waits ${input.turn_detection ? input.turn_detection.eagerness : "-"})`);
  }

  return {
    start, stop, cue, hush, stat,
    listen: (mode) => {
      listening = mode;
      if (mode === "pick") { clearTimeout(gateT); gate(true); }   // the cards: a card can be called over its comment
      else if (speaking) gate(false);
    },
    idle: () => waitIdle(45000),                               // resolves when it has finished speaking (the end of a life waits for it)
    get on() { return on(); },
    get showText() { return !on() || subs === "on" || (subs !== "off" && !!(cfg && cfg.show_text)); },
    setSubtitles: (v) => { subs = v === "on" || v === "off" ? v : ""; },
    setLive,
    _live: () => ({ ...P, moments: { ...P.moments }, volume_now: audio.volume, subs, input: inputWanted() }),   // (tests: what it took from /panel)
    get model() { return cfg ? `${cfg.model}, ${cfg.voice}` : ""; },
  };
}
