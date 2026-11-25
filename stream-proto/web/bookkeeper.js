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
export function createBookkeeper({ onPick = () => ({ ok: false, reason: "the cards aren't up" }) } = {}) {
  const stat = { state: "off", note: "", said: 0, heard: 0, last: "" };
  let pc = null, dc = null, mic = null, cfg = null, life = "", session = 0, subs = "";   // subs: the panel's SUBTITLES ("" / "on" / "off")
  // the panel's Voice tab, live: how fast, how loud, how long its lines, a breath before each, which moments it speaks at
  const P = { speed: 1, volume: 1, length: 1, breath: 0.4, moments: {}, talk_back: true, mic: "", listen: "" };
  let speedSent = 1;                                           // the speed the session has now (it changes between lines only)
  const BUDGET = { arrive: 45, cards: 30, outcome: 35, happened: 35, fluke: 18, close: 70 };   // words, as bookkeeper.md has them
  const GROUP = { arrive: "arrive", cards: "cards", outcome: "outcome", happened: "outcome", fluke: "fluke", close: "close" };
  const audio = Object.assign(document.createElement("audio"), { autoplay: true });
  audio.setAttribute("aria-hidden", "true");
  document.body.appendChild(audio);

  // one waiter per answer asked for: resolved when its sound has finished (or it was cut, or it took too long)
  const asked = [];                          // asked for, not yet created by the server (FIFO)
  const byId = new Map();                    // response id -> waiter
  let generating = 0, speaking = false, listening = "closed", playerWaiting = false;

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
  async function start(lifeId = "") {
    stop();
    const mine = ++session;
    life = String(lifeId); stat.state = "connecting"; stat.note = "";
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
        if (["failed", "closed", "disconnected"].includes(pc && pc.connectionState) && mine === session) {
          stat.state = "lost"; stat.note = "connection " + pc.connectionState; finishAll();
        }
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
      stat.state = "ready"; stat.said = stat.heard = 0; speedSent = cfg.speed || 1;
      inputSent = JSON.stringify(cfg.input || {}); applyInput();   // (the panel may have changed while it connected)
      return true;
    } catch (e) {
      if (mine === session) { stop(); stat.state = "off"; stat.note = String(e.message || e).slice(0, 180); }
      console.warn("[voice] no voice this life:", e);
      return false;
    }
  }
  function stop() {
    session++;
    finishAll();
    try { dc && dc.close(); } catch (e) {}
    try { pc && pc.close(); } catch (e) {}
    if (mic) mic.getTracks().forEach(x => x.stop());
    pc = dc = mic = null; generating = 0; speaking = false; playerWaiting = false; listening = "closed";
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
        speaking = true;
        dispatchEvent(new CustomEvent("pac-voice", { detail: { speaking: true } }));   // (the game's sound ducks under it)
        { const w = byId.get(ev.response_id); if (w) w.audio = true; }
        break;
      case "output_audio_buffer.stopped":
        speaking = false;
        dispatchEvent(new CustomEvent("pac-voice", { detail: { speaking: false } }));   // (the game's sound ducks under it)
        finish(byId.get(ev.response_id)); byId.delete(ev.response_id);
        afterSpeaking();
        break;
      case "output_audio_buffer.cleared":
        speaking = false;
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
        else if (w && !w.audio) setTimeout(() => { if (!w.audio) { finish(w); byId.delete(resp.id); afterSpeaking(); } }, 700);   // nothing to hear (a tool call only)
        break;
      }
      case "response.output_audio_transcript.done":
        stat.said++; stat.last = ev.transcript || ""; log("bookkeeper", ev.transcript);
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
  function heard(text) {
    if (!/[a-z]{2}/i.test(text)) return;                        // a cough, a chair: nothing to answer
    stat.heard++; log("player", text);
    if (!cfg || !cfg.player_can_talk || !P.talk_back || listening === "closed") return;
    if (generating || speaking) { playerWaiting = true; return; }   // it finishes its line first
    answerPlayer();
  }
  function answerPlayer() {
    playerWaiting = false;
    respond(listening === "pick" ? "auto" : "none", 15000);
  }
  function afterSpeaking() {
    if (playerWaiting && !generating && !speaking && listening !== "closed" && on()) answerPlayer();
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
    if (!res.ok) respond("none", 12000);                          // it tells the player why not; after a pick: silence
  }

  // ---------- asking it to speak ----------
  function respond(toolChoice, maxMs) {
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
  async function hush() {
    if (!on()) return;
    playerWaiting = false;
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
    if (generating || speaking) await hush();                  // the game's moment comes first
    log("game", text);
    send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    if (P.breath > 0) await new Promise(r => setTimeout(r, P.breath * 1000));   // a beat before it speaks
    if (!on()) return;
    await respond("none");
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
    listen: (mode) => { listening = mode; if (mode === "closed") playerWaiting = false; else afterSpeaking(); },
    get on() { return on(); },
    get showText() { return !on() || subs === "on" || (subs !== "off" && !!(cfg && cfg.show_text)); },
    setSubtitles: (v) => { subs = v === "on" || v === "off" ? v : ""; },
    setLive,
    _live: () => ({ ...P, moments: { ...P.moments }, volume_now: audio.volume, subs, input: inputWanted() }),   // (tests: what it took from /panel)
    get model() { return cfg ? `${cfg.model}, ${cfg.voice}` : ""; },
  };
}
