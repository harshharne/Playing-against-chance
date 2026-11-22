// sound.js — the game's sound, under the Bookkeeper's voice. Tone.js (MIT, web/vendor/Tone.js), all generated live:
// no files needed, nothing from the internet. Three layers, each on its own channel:
//
//   BED       the life's weather: a slow chord that moves with the years (bright and high in childhood, lower and
//             sparser with age) and with chance (a hit opens it, a miss bends it, a bad turn darkens it).
//   PLACE     ambience for the scene on screen, from its words (or the director's sound tags): rain, wind, a ceiling
//             fan, a classroom's murmur, a street with horns, birds and a koel at dawn, crickets at night, a train,
//             a clock, a kitchen, temple bells, typing, a ward. Up to three at once; they cross-fade with the picture.
//             A recording can replace any of them: put it in web/sounds/ and name it in web/sounds/manifest.json
//             ({"rain": "rain.ogg"}): it is played in a loop instead.
//   CUES      the game's own moments: options rising, the choice locking, the screen's throw, the die landing
//             (a note for each number), hit or miss, the screen waking, the years ticking past.
//
// Rules: the voice always wins (everything but the cues ducks while it speaks); silence is material (the black screen
// and the end of a life are silent); restraint (low levels, slow changes).
//
//   const sound = createSound();             sound.unlock()  (also by itself on the first click or key)
//   sound.wake() / sound.sleep(ms)           the screen comes up / goes black
//   sound.age(a)                             the life's age (the bed's register and mode); call at each arrival
//   sound.scene(words, ms, tags?)            a new place: its ambience fades in over ms
//   sound.mood("hit"|"miss"|"good"|"bad"|"neutral")
//   sound.cue(name, ...)                     "rise" n gapMs · "lock" · "rattle" · "land" n hit · "year" · "arrive" ms · "bell"
//   sound.duck(on) · sound.pause(on) · sound.end(ms) · sound.setMix({on, master, bed, place, cues, duck})
//   sound.stat                               what is playing (for the debug line and the panel)

export const KITS = ["room", "fan", "murmur", "crowd", "children", "street", "rain", "wind", "birds", "night",
                     "train", "water", "clock", "kitchen", "bells", "typing", "hospital"];

// scene words -> kits (first match wins its place; at most three)
const WORDS = [
  ["rain", /\b(rain|rainy|monsoon|drizzle|downpour|storm|puddles?|umbrellas?)\b/i],
  ["train", /\b(train|railway|platform|station|tracks?|compartment)\b/i],
  ["hospital", /\b(hospital|clinic|ward|doctor|nurse|icu|drip)\b/i],
  ["crowd", /\b(crowd(ed)?|canteen|corridor|market|bazaar|festival|wedding|party|queue|gate|annual day|celebration|fair|mela|cinema|stadium|rally)\b/i],
  ["children", /\b(playground|children|kids|schoolyard|recess|games?)\b/i],
  ["murmur", /\b(classroom|class|lecture|tuition|coaching|students|office|meeting|staff ?room|interview|waiting room)\b/i],
  ["street", /\b(street|road|lane|traffic|bus|scooters?|auto|rickshaw|city|town|crossing|highway|shop)\b/i],
  ["bells", /\b(temple|marigolds?|prayer|puja|diwali|church|mosque|bells?|shrine|garland)\b/i],
  ["kitchen", /\b(kitchen|cooking|dinner|lunch|breakfast|meal|stove|tea|chai|cups?)\b/i],
  ["typing", /\b(computer|typing|keyboard|cubicle|desk job|bank|laptop)\b/i],
  ["fan", /\b(ceiling fan|fan turning|fan)\b/i],
  ["clock", /\b(clock|exam|midnight|waiting|ticking)\b/i],
  ["water", /\b(sea|beach|river|lake|waves?|ghat|boat|shore|pond)\b/i],
  ["night", /\b(night|midnight|moon(lit)?|stars|crickets|late evening|dusk)\b/i],
  ["birds", /\b(dawn|morning|sunrise|garden|trees?|village|park|veranda|balcony|field|farm)\b/i],
  ["wind", /\b(wind|breeze|rooftop|kites?|hill|cliff|open sky|terrace|desert|empty)\b/i],
];
const INDOOR = /\b(room|house|home|kitchen|classroom|office|hall|hostel|bedroom|flat|apartment|ward|clinic|corridor|canteen|desk|library|shop)\b/i;

export function tagsFor(words) {
  const t = [];
  for (const [k, re] of WORDS) if (re.test(words) && !t.includes(k)) t.push(k);
  if (INDOOR.test(words) && !t.includes("room") && !t.includes("murmur") && !t.includes("crowd")) t.push("room");
  if (t.includes("crowd") && t.includes("murmur")) t.splice(t.indexOf("murmur"), 1);   // a crowd already murmurs
  if (t.includes("night") && t.includes("birds")) t.splice(t.indexOf("birds"), 1);       // no birdsong at night
  if (/\bexam\b/i.test(words)) { const i = t.indexOf("murmur"); if (i >= 0) t.splice(i, 1); }   // an exam hall is silent but for the clock
  if (!t.length) t.push(INDOOR.test(words) ? "room" : "wind");
  return t.slice(0, 3);
}

export function createSound({ base = "" } = {}) {
  const T = window.Tone;
  const stat = { ready: false, on: true, kits: [], bed: "", mood: "", note: T ? "" : "no Tone.js", ducked: false };
  if (!T) return stub(stat);
  const mix = { on: true, master: 0, bed: -8, place: -8, cues: -4, duck: 10 };
  // each place kit levelled to one loudness (measured), then given its character: a room is quieter than a street
  const TRIM = { room: 11, fan: 15, murmur: 15, crowd: 15, children: 18, street: 12, rain: 15, wind: 23, birds: 20, night: 17,
                 train: 12, water: 17, clock: 13, kitchen: 14, bells: 20, typing: 13, hospital: 13 };
  const now = () => T.now();
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
  const timers = new Set();
  const later = (ms, f) => { const id = setTimeout(() => { timers.delete(id); try { f(); } catch (e) { stat.note = "sound: " + e.message; } }, ms); timers.add(id); return id; };

  // ---------- the mix: bed and place duck under the voice; everything through one limiter ----------
  let built = false, M = null;
  function build() {
    if (built) return;
    built = true;
    const limiter = new T.Limiter(-1).toDestination();
    const master = new T.Gain(0).connect(limiter);              // starts silent: the screen starts black
    const duckBus = new T.Gain(1).connect(master);
    const bed = new T.Channel(mix.bed).connect(duckBus);
    const place = new T.Channel(mix.place).connect(duckBus);
    const cues = new T.Channel(mix.cues).connect(master);
    const space = new T.Reverb({ decay: 6, wet: 1 }).connect(place);       // the outdoor air shared by the place kits
    const spaceSend = new T.Gain(0.35).connect(space);
    const cueVerb = new T.Reverb({ decay: 3.5, wet: 0.35 }).connect(cues);
    M = { limiter, master, duckBus, bed, place, cues, space, spaceSend, cueVerb };
    makeBed();
    stat.ready = true;
  }
  function setMix(m = {}) {
    Object.assign(mix, Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined && v !== null)));
    stat.on = mix.on !== false;
    if (!M) return;
    M.bed.volume.rampTo(mix.bed, 0.4); M.place.volume.rampTo(mix.place, 0.4); M.cues.volume.rampTo(mix.cues, 0.4);
    levelMaster(0.6);
  }
  let awake = false, paused = false;
  function levelMaster(sec) {
    if (!M) return;
    const g = awake && !paused && stat.on ? T.dbToGain(mix.master) : 0;
    M.master.gain.cancelScheduledValues(now());
    M.master.gain.rampTo(g, sec);
  }

  // ---------- unlocking: browsers allow sound only after a click or a key ----------
  async function unlock() {
    try { await T.start(); build(); stat.note = ""; } catch (e) { stat.note = "sound blocked: click once"; }
  }
  const first = () => { unlock(); removeEventListener("pointerdown", first); removeEventListener("keydown", first); };
  addEventListener("pointerdown", first); addEventListener("keydown", first);

  // ======================================================================== the BED
  // modes by age: childhood bright (lydian), youth (ionian), adulthood (dorian), later (aeolian), old age (phrygian)
  const MODES = [[0, "lydian", [0, 2, 4, 6, 7, 9, 11], 62], [13, "ionian", [0, 2, 4, 5, 7, 9, 11], 60], [26, "dorian", [0, 2, 3, 5, 7, 9, 10], 57],
                 [50, "aeolian", [0, 2, 3, 5, 7, 8, 10], 55], [70, "phrygian", [0, 1, 3, 5, 7, 8, 10], 52]];
  let mode = MODES[0], lifeAge = 0, bedOn = false, colour = 0;   // colour: +1 opened by a hit, -1 bent by a miss / bad turn
  let pad = null, padFilter = null, tone = null, pluck = null, sub = null, chord = [];
  const mtof = (m) => T.Frequency(m, "midi").toFrequency();
  function makeBed() {
    tone = new T.Filter({ type: "lowpass", frequency: 1800, Q: 0.3 }).connect(M.bed);   // the colour: chance opens or closes it
    padFilter = new T.Filter({ type: "lowpass", frequency: 900, Q: 0.4 }).connect(tone); // the slow breathing (an LFO moves it)
    const lfo = new T.LFO({ frequency: 0.04, min: 600, max: 1500 }).start(); lfo.connect(padFilter.frequency);
    const chorus = new T.Chorus({ frequency: 0.3, delayTime: 6, depth: 0.5, wet: 0.4 }).start().connect(padFilter);
    const verb = new T.Reverb({ decay: 10, wet: 0.55 }).connect(chorus);
    pad = new T.PolySynth(T.AMSynth, { harmonicity: 1.5, oscillator: { type: "sine" }, modulation: { type: "triangle" },
                                       envelope: { attack: 4, decay: 1, sustain: 0.8, release: 7 } }).connect(verb);
    pad.maxPolyphony = 24;
    pad.volume.value = 2;
    const delay = new T.FeedbackDelay({ delayTime: "4n.", feedback: 0.35, wet: 0.35 }).connect(verb);
    pluck = new T.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.01, decay: 0.6, sustain: 0, release: 1.2 } }).connect(delay);
    pluck.volume.value = -4;
    sub = new T.Oscillator({ frequency: 41, type: "sine", volume: -40 }).connect(M.bed);
  }
  function modeAt(a) { let m = MODES[0]; for (const x of MODES) if (a >= x[0]) m = x; return m; }
  function chordFrom(m, degree, c) {                           // a soft voicing: 1-3-5 (+7 when opened, a flat 2nd above when bent)
    const sc = m[2], root = m[3] - 12;
    const deg = (d) => root + sc[d % 7] + 12 * Math.floor(d / 7);
    const notes = [deg(degree), deg(degree + 2) + 12, deg(degree + 4)];
    if (c > 0) notes.push(deg(degree + 6) + 12);                // a hit: the chord opens (adds its 7th, up high)
    if (c < 0) notes.push(deg(degree) + 13);                    // a miss: one note rubs against the root
    return notes;
  }
  let chordTimer = 0, chordSec = 6;
  function nextChord(sec = 6) {                                // changes close together become one (no pile of chords)
    chordSec = Math.min(chordSec, sec);
    clearTimeout(chordTimer);
    chordTimer = setTimeout(() => { const s = chordSec; chordSec = 99; doChord(s); }, 400);
  }
  function doChord(sec) {
    if (!pad || !bedOn) return;
    const degree = pick(colour < 0 ? [3, 5, 1] : [0, 3, 4, 5, 0]);
    const notes = chordFrom(mode, degree, colour);
    pad.releaseAll(now());
    later(200, () => { if (bedOn) pad.triggerAttack(notes.map(mtof), now(), 0.35); });
    chord = notes;
    tone.frequency.rampTo(colour > 0 ? 3200 : colour < 0 ? 900 : 1800, sec);
    sub.volume.rampTo(colour < 0 ? -26 : -40, sec);
    stat.bed = `${mode[1]} · ${colour > 0 ? "open" : colour < 0 ? "bent" : "plain"}`;
  }
  let plucking = 0;
  function plucks() {                                          // sparse notes from the chord: more in childhood, fewer with age
    const my = ++plucking;
    const go = () => {
      if (my !== plucking || !bedOn) return;
      const sparse = 3 + lifeAge / 9;                           // seconds between notes, on average
      if (chord.length && Math.random() < 0.8) pluck.triggerAttackRelease(mtof(pick(chord) + 12), "8n", now(), rnd(0.2, 0.5));
      later(rnd(sparse * 0.5, sparse * 1.6) * 1000, go);
    };
    later(2500, go);
  }
  function startBed() { if (!M || bedOn) return; bedOn = true; sub.start(); nextChord(4); plucks(); }
  function stopBed(sec = 4) {
    if (!bedOn) return;
    bedOn = false; plucking++;
    if (pad) pad.releaseAll(now());
    if (sub) { sub.volume.rampTo(-80, sec); later(sec * 1000 + 200, () => { if (!bedOn) sub.stop(); }); }
  }

  // ======================================================================== the PLACE kits
  // Every kit: (out) -> { stop() }; it plays into `out` (a gain that fades in/out) and cleans up after itself.
  const noise = (type, vol = 0) => new T.Noise({ type, volume: vol }).start();
  function kitRoom(out) {
    const n = noise("brown", -6), lp = new T.Filter(260, "lowpass"), g = new T.Gain(0.18).connect(out);
    n.chain(lp, g);
    const hum = new T.Oscillator({ frequency: 50, type: "sine", volume: -42 }).connect(out).start();
    return [n, lp, g, hum];
  }
  function kitFan(out) {
    const n = noise("pink", -8), bp = new T.Filter({ type: "bandpass", frequency: 850, Q: 0.6 });
    const trem = new T.Tremolo({ frequency: 3.3, depth: 0.45, spread: 0 }).start(), g = new T.Gain(0.35).connect(out);
    n.chain(bp, trem, g);
    const hum = noise("brown", -10), lp = new T.Filter(140, "lowpass"), hg = new T.Gain(0.25).connect(out);
    hum.chain(lp, hg);
    return [n, bp, trem, g, hum, lp, hg];
  }
  function kitMurmur(out, { voices = 7, lo = 350, hi = 1300, rate = [0.1, 0.22], gap = [0.2, 1.4], level = 0.32, spread = 0.6, calls = 0 } = {}) {
    // speech-like babble: each voice is noise through a moving formant, switched on and off in syllables and phrases
    const sum = new T.Filter(2600, "lowpass"), g = new T.Gain(level).connect(out);
    sum.connect(g); sum.connect(M.spaceSend);
    const vs = [];
    for (let i = 0; i < voices; i++) {
      const n = noise(pick(["pink", "white"]), -4), f = new T.Filter({ type: "bandpass", frequency: rnd(lo, hi), Q: rnd(2.5, 5) });
      const f2 = new T.Filter({ type: "bandpass", frequency: rnd(lo * 2.2, hi * 2.2), Q: 4 }), env = new T.Gain(0);
      const pan = new T.Panner(rnd(-spread, spread));
      n.fan(f, f2); f.connect(env); f2.connect(env); env.chain(pan, sum);
      vs.push({ n, f, f2, env, pan, next: now() + rnd(0, 1.5), phraseEnd: 0 });
    }
    let live = true;
    const tick = setInterval(() => {                           // one scheduler for all voices, a little ahead of time
      if (!live) return;
      const t0 = now();
      for (const v of vs) {
        while (v.next < t0 + 0.3) {
          if (v.next > v.phraseEnd) {                           // a new phrase after a pause
            const pause = rnd(gap[0], gap[1]);
            v.next += pause; v.phraseEnd = v.next + rnd(0.8, 3.5);
            const c = rnd(lo, hi); v.f.frequency.setValueAtTime(c, v.next); v.f2.frequency.setValueAtTime(c * rnd(2, 2.6), v.next);
            continue;
          }
          const d = rnd(rate[0], rate[1]), peak = Math.random() < 0.15 ? rnd(0.05, 0.2) : rnd(0.35, 1);
          v.env.gain.setTargetAtTime(peak, v.next, 0.02);
          v.env.gain.setTargetAtTime(0.02, v.next + d * 0.6, 0.03);
          v.f.frequency.setTargetAtTime(v.f.frequency.value * rnd(0.85, 1.18), v.next, 0.05);
          v.next += d;
        }
      }
      if (calls && Math.random() < calls * 0.1) call();         // children: a call or a squeal now and then
    }, 100);
    function call() {
      const o = new T.Oscillator({ type: "triangle", frequency: rnd(550, 800), volume: -30 }), vib = new T.Vibrato(7, 0.15);
      const e = new T.AmplitudeEnvelope({ attack: 0.05, decay: 0.1, sustain: 0.7, release: 0.25 }), p = new T.Panner(rnd(-0.7, 0.7));
      o.chain(vib, e, p, sum); o.start();
      const t = now() + 0.05, d = rnd(0.25, 0.6);
      o.frequency.exponentialRampTo(o.frequency.value * rnd(1.2, 1.6), d, t);
      e.triggerAttackRelease(d, t);
      later((d + 1) * 1000, () => [o, vib, e, p].forEach(x => x.dispose()));
    }
    return [{ dispose() { live = false; clearInterval(tick); } }, sum, g, ...vs.flatMap(v => [v.n, v.f, v.f2, v.env, v.pan])];
  }
  function kitStreet(out) {
    const n = noise("brown", -2), lp = new T.Filter(380, "lowpass"), g = new T.Gain(0.3).connect(out);
    n.chain(lp, g);
    const cars = noise("pink", -6), clp = new T.Filter(700, "lowpass"), cg = new T.Gain(0), cp = new T.Panner(0).connect(out);
    cars.chain(clp, cg, cp);
    let live = true;
    const pass = () => {                                       // a vehicle passes: swells and travels across
      if (!live) return;
      const t = now(), d = rnd(2.5, 5), dir = Math.random() < 0.5 ? -1 : 1;
      cp.pan.setValueAtTime(-0.85 * dir, t); cp.pan.linearRampTo(0.85 * dir, d, t);
      cg.gain.setTargetAtTime(rnd(0.25, 0.5), t, d / 4); cg.gain.setTargetAtTime(0, t + d * 0.55, d / 5);
      clp.frequency.setTargetAtTime(rnd(900, 1600), t, d / 4); clp.frequency.setTargetAtTime(600, t + d * 0.55, d / 5);
      later(rnd(1.5, 6) * 1000, pass);
    };
    const horn = new T.PolySynth(T.Synth, { oscillator: { type: "square" }, envelope: { attack: 0.02, decay: 0.05, sustain: 0.9, release: 0.08 } });
    const hf = new T.Filter(1600, "lowpass"), hp = new T.Panner(0); horn.chain(hf, hp, out); horn.volume.value = -32;
    hp.connect(M.spaceSend);
    const honk = () => {                                       // a horn, sometimes twice: the sound of an Indian street
      if (!live) return;
      hp.pan.value = rnd(-0.8, 0.8);
      const f = rnd(330, 520), t = now() + 0.05, d = rnd(0.15, 0.45);
      horn.triggerAttackRelease([f, f * 1.26], d, t);
      if (Math.random() < 0.45) horn.triggerAttackRelease([f, f * 1.26], d * 0.7, t + d + 0.12);
      later(rnd(4, 14) * 1000, honk);
    };
    later(800, pass); later(rnd(2, 6) * 1000, honk);
    return [{ dispose() { live = false; } }, n, lp, g, cars, clp, cg, cp, horn, hf, hp];
  }
  function kitRain(out, heavy = 0) {
    const n = noise("pink", -4), hp = new T.Filter(450, "highpass"), lp = new T.Filter(7000, "lowpass"), g = new T.Gain(0.4 + heavy * 0.2).connect(out);
    n.chain(hp, lp, g);
    const drop = new T.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.03, sustain: 0 } });
    const df = new T.Filter({ type: "bandpass", frequency: 3000, Q: 3 }), dp = new T.Panner(0);
    drop.chain(df, dp, out); drop.volume.value = -26;
    let live = true;
    const tick = setInterval(() => {                           // drops on things nearby
      if (!live) return;
      let t = now() + 0.02;
      for (let i = 0; i < 3; i++) {
        t += rnd(0.01, 0.04);                                   // (a synth's notes must come in order)
        df.frequency.setValueAtTime(rnd(1800, 6000), t); dp.pan.setValueAtTime(rnd(-0.9, 0.9), t);
        drop.triggerAttackRelease(0.02, t, rnd(0.2, 1));
      }
    }, 120);
    return [{ dispose() { live = false; clearInterval(tick); } }, n, hp, lp, g, drop, df, dp];
  }
  function kitWind(out) {
    const n = noise("pink", -6), bp = new T.Filter({ type: "bandpass", frequency: 450, Q: 1.3 });
    const ap = new T.AutoPanner(0.05).start(), g = new T.Gain(0.3).connect(out);
    n.chain(bp, ap, g);
    let live = true;
    const gust = () => { if (!live) return; const t = now(), d = rnd(2, 5);
      bp.frequency.setTargetAtTime(rnd(250, 1000), t, d / 2); g.gain.setTargetAtTime(rnd(0.15, 0.45), t, d / 2); later(d * 1000, gust); };
    gust();
    return [{ dispose() { live = false; } }, n, bp, ap, g];
  }
  function kitBirds(out) {
    const s = new T.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.005, decay: 0.06, sustain: 0.2, release: 0.05 } });
    const p = new T.Panner(0); s.chain(p, out); p.connect(M.spaceSend); s.volume.value = -22;
    const koel = new T.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.06, decay: 0.1, sustain: 0.8, release: 0.15 } });
    const kp = new T.Panner(0); koel.chain(kp, out); kp.connect(M.spaceSend); koel.volume.value = -26;
    let live = true;
    const song = () => {
      if (!live) return;
      let t = now() + 0.05;
      p.pan.setValueAtTime(rnd(-0.9, 0.9), t);
      const kind = Math.random();
      if (kind < 0.5) {                                         // a run of quick chirps, falling
        let f = rnd(3200, 5200);
        for (let i = 0, k = 2 + Math.floor(rnd(0, 5)); i < k; i++) {
          s.frequency.setValueAtTime(f, t); s.frequency.exponentialRampToValueAtTime(f * 0.75, t + 0.05);
          s.triggerAttackRelease(f, 0.05, t, rnd(0.4, 1)); t += rnd(0.08, 0.14); f *= rnd(0.92, 0.98);
        }
      } else {                                                  // a two-note whistle
        const f = rnd(2000, 2800);
        s.triggerAttackRelease(f, 0.12, t, 0.7); s.triggerAttackRelease(f * rnd(1.1, 1.3), 0.16, t + 0.18, 0.8);
      }
      later(rnd(0.6, 3.2) * 1000, song);
    };
    const koelCall = () => {                                    // the koel: "ku-oo", rising each time
      if (!live) return;
      kp.pan.value = rnd(-0.6, 0.6);
      let t = now() + 0.1, f = rnd(700, 850);
      for (let i = 0, k = 3 + Math.floor(rnd(0, 4)); i < k; i++) {
        koel.triggerAttack(f, t, 0.8); koel.frequency.setValueAtTime(f, t);
        koel.frequency.exponentialRampToValueAtTime(f * 1.45, t + 0.32); koel.triggerRelease(t + 0.38);
        t += rnd(0.6, 0.9); f *= 1.06;
      }
      later(rnd(12, 30) * 1000, koelCall);
    };
    song(); later(rnd(3, 10) * 1000, koelCall);
    return [{ dispose() { live = false; } }, s, p, koel, kp];
  }
  function kitNight(out) {
    const parts = [];
    for (let i = 0; i < 3; i++) {                               // crickets: a high tone in pulse trains
      const o = new T.Oscillator({ frequency: rnd(4100, 4800), type: "sine", volume: -30 }).start();
      const pulse = new T.Gain(0), gate = new T.Gain(0), pan = new T.Panner(rnd(-0.8, 0.8)).connect(out);
      const l1 = new T.LFO({ frequency: rnd(26, 32), min: 0, max: 1, type: "square" }).start().connect(pulse.gain);
      const l2 = new T.LFO({ frequency: rnd(1.4, 2.3), min: 0, max: 1, type: "square" }).start().connect(gate.gain);
      o.chain(pulse, gate, pan);
      parts.push(o, pulse, gate, pan, l1, l2);
    }
    const air = noise("brown", -14), lp = new T.Filter(200, "lowpass"), g = new T.Gain(0.15).connect(out);
    air.chain(lp, g);
    return [...parts, air, lp, g];
  }
  function kitTrain(out) {
    const n = noise("brown", 0), lp = new T.Filter(130, "lowpass"), g = new T.Gain(0.35).connect(out);
    n.chain(lp, g);
    const clack = new T.NoiseSynth({ noise: { type: "brown" }, envelope: { attack: 0.002, decay: 0.08, sustain: 0 } });
    const cf = new T.Filter(900, "lowpass"); clack.chain(cf, out); clack.volume.value = -14;
    const horn = new T.PolySynth(T.Synth, { oscillator: { type: "sawtooth" }, envelope: { attack: 0.15, decay: 0.1, sustain: 0.9, release: 0.5 } });
    const hf = new T.Filter(1100, "lowpass"); horn.chain(hf, out); hf.connect(M.spaceSend); horn.volume.value = -34;
    let live = true;
    const run = () => { if (!live) return; const t = now() + 0.05;     // da-dum ... da-dum
      clack.triggerAttackRelease(0.05, t, 0.8); clack.triggerAttackRelease(0.05, t + 0.16, 0.6); later(rnd(1.0, 1.4) * 1000, run); };
    const blow = () => { if (!live) return; horn.triggerAttackRelease([311, 392], rnd(1.2, 2), now() + 0.1); later(rnd(20, 45) * 1000, blow); };
    run(); later(rnd(4, 12) * 1000, blow);
    return [{ dispose() { live = false; } }, n, lp, g, clack, cf, horn, hf];
  }
  function kitWater(out) {
    const n = noise("pink", -4), lp = new T.Filter(900, "lowpass"), g = new T.Gain(0.1).connect(out);
    n.chain(lp, g);
    let live = true;
    const wave = () => { if (!live) return; const t = now(), d = rnd(3, 6);
      g.gain.setTargetAtTime(rnd(0.3, 0.5), t, d / 3); lp.frequency.setTargetAtTime(rnd(1400, 2200), t, d / 3);
      g.gain.setTargetAtTime(0.08, t + d * 0.5, d / 3); lp.frequency.setTargetAtTime(700, t + d * 0.5, d / 3); later(d * 1000, wave); };
    wave();
    return [{ dispose() { live = false; } }, n, lp, g];
  }
  function kitClock(out) {
    const s = new T.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.012, sustain: 0 } });
    const f = new T.Filter({ type: "bandpass", frequency: 3200, Q: 8 }); s.chain(f, out); s.volume.value = -22;
    let i = 0;
    const id = setInterval(() => { const t = now() + 0.05; f.frequency.setValueAtTime(i++ % 2 ? 2600 : 3300, t); s.triggerAttackRelease(0.01, t); }, 1000);
    return [{ dispose() { clearInterval(id); } }, s, f, ...kitRoom(out)];
  }
  function kitKitchen(out) {
    const m = new T.MetalSynth({ envelope: { attack: 0.001, decay: 0.25, release: 0.1 }, harmonicity: 5.1, modulationIndex: 16, resonance: 3200, octaves: 0.8 });
    const p = new T.Panner(0); m.chain(p, out); p.connect(M.spaceSend); m.volume.value = -34;
    let live = true;
    const clink = () => { if (!live) return; p.pan.value = rnd(-0.6, 0.6); m.frequency.value = rnd(250, 500);
      m.triggerAttackRelease("32n", now() + 0.05, rnd(0.2, 0.6)); if (Math.random() < 0.3) m.triggerAttackRelease("32n", now() + 0.2, 0.3);
      later(rnd(2.5, 9) * 1000, clink); };
    later(1500, clink);
    return [{ dispose() { live = false; } }, m, p, ...kitRoom(out)];
  }
  function kitBells(out) {
    const b = new T.FMSynth({ harmonicity: 3.01, modulationIndex: 12, envelope: { attack: 0.002, decay: 2.5, sustain: 0, release: 2 },
                              modulationEnvelope: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.5 } });
    const p = new T.Panner(0); b.chain(p, out); p.connect(M.spaceSend); b.volume.value = -26;
    const PENTA = [0, 2, 4, 7, 9];
    let live = true;
    const ring = () => { if (!live) return; p.pan.value = rnd(-0.7, 0.7);
      const n = 72 + pick(PENTA) + 12 * Math.floor(rnd(0, 2)); b.triggerAttackRelease(mtof(n), 2, now() + 0.05, rnd(0.3, 0.8));
      later(rnd(2, 7) * 1000, ring); };
    ring();
    return [{ dispose() { live = false; } }, b, p];
  }
  function kitTyping(out) {
    const s = new T.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.02, sustain: 0 } });
    const f = new T.Filter({ type: "bandpass", frequency: 2200, Q: 2 }); s.chain(f, out); s.volume.value = -26;
    let live = true;
    const burst = () => { if (!live) return; let t = now() + 0.05;
      for (let i = 0, k = Math.floor(rnd(8, 30)); i < k; i++) { f.frequency.setValueAtTime(rnd(1700, 2800), t); s.triggerAttackRelease(0.015, t, rnd(0.4, 1)); t += rnd(0.06, 0.16); }
      later((t - now() + rnd(1.5, 5)) * 1000, burst); };
    later(1000, burst);
    return [{ dispose() { live = false; } }, s, f, ...kitRoom(out)];
  }
  function kitHospital(out) {
    const s = new T.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.005, decay: 0.05, sustain: 0.8, release: 0.03 } }).connect(out);
    s.volume.value = -32;
    const id = setInterval(() => s.triggerAttackRelease(988, 0.09, now() + 0.05), 1100);
    return [{ dispose() { clearInterval(id); } }, s, ...kitRoom(out), ...kitMurmur(out, { voices: 3, level: 0.12, gap: [1, 3] })];
  }
  const BUILD = {
    room: kitRoom, fan: kitFan, murmur: (o) => kitMurmur(o), crowd: (o) => kitMurmur(o, { voices: 12, level: 0.42, gap: [0.05, 0.6], spread: 0.95 }),
    children: (o) => kitMurmur(o, { voices: 8, lo: 800, hi: 2100, rate: [0.07, 0.16], level: 0.32, spread: 0.95, calls: 0.25 }),
    street: kitStreet, rain: (o) => kitRain(o, 0), wind: kitWind, birds: kitBirds, night: kitNight, train: kitTrain, water: kitWater,
    clock: kitClock, kitchen: kitKitchen, bells: kitBells, typing: kitTyping, hospital: kitHospital,
  };
  let files = null;                                            // web/sounds/manifest.json: recordings that replace kits
  fetch(base + "sounds/manifest.json", { cache: "no-store" }).then(r => r.ok ? r.json() : {}).then(j => { files = j || {}; }).catch(() => { files = {}; });
  function startKit(name, fadeSec) {
    const out = new T.Gain(0).connect(M.place);
    let parts;
    try {
      if (files && files[name]) {
        const pl = new T.Player({ url: base + "sounds/" + files[name], loop: true, autostart: true, fadeIn: 0.1 }).connect(out);
        parts = [pl];
      } else parts = BUILD[name](out);
    } catch (e) { console.warn("[sound]", name, e); out.dispose(); return null; }
    out.gain.rampTo(T.dbToGain(TRIM[name] || 12), fadeSec);
    return { name, out, parts };
  }
  function stopKit(k, fadeSec) {
    k.out.gain.cancelScheduledValues(now());
    k.out.gain.rampTo(0, fadeSec);
    later(fadeSec * 1000 + 300, () => { for (const p of k.parts) { try { p.stop && p.stop(); } catch (e) {} try { p.dispose(); } catch (e) {} } k.out.dispose(); });
  }
  let playing = [], pending = null;
  function scene(words, ms = 3000, tags = null) {
    if (!M || !awake) { pending = [words, tags]; return; }      // painted in the dark: it sounds when the screen wakes
    pending = null;
    const want = (tags && tags.length ? tags.filter(t => BUILD[t]) : tagsFor(words || "")).slice(0, 3);
    const sec = Math.max(0.8, ms / 1000);
    const keep = playing.filter(k => want.includes(k.name)), go = playing.filter(k => !want.includes(k.name));
    go.forEach(k => stopKit(k, sec * 0.9));
    const add = want.filter(n => !keep.some(k => k.name === n)).map(n => startKit(n, sec)).filter(Boolean);
    playing = [...keep, ...add];
    stat.kits = playing.map(k => k.name);
  }
  function clearPlace(sec = 2) { playing.forEach(k => stopKit(k, sec)); playing = []; stat.kits = []; }

  // ======================================================================== the CUES
  let C = null;
  function cuesBuilt() {
    if (C) return C;
    const soft = new T.PolySynth(T.Synth, { oscillator: { type: "sine" }, envelope: { attack: 0.005, decay: 0.4, sustain: 0, release: 0.8 } }).connect(M.cueVerb);
    soft.volume.value = 2;
    const thud = new T.MembraneSynth({ pitchDecay: 0.06, octaves: 4, envelope: { attack: 0.001, decay: 0.35, sustain: 0 } }).connect(M.cueVerb);
    thud.volume.value = 0;
    const bell = new T.FMSynth({ harmonicity: 3.01, modulationIndex: 8, envelope: { attack: 0.002, decay: 1.6, sustain: 0, release: 1.4 },
                                 modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.4 } }).connect(M.cueVerb);
    bell.volume.value = -2;
    const swish = new T.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.4, decay: 0.6, sustain: 0 } });
    const swf = new T.AutoFilter({ frequency: 0.5, baseFrequency: 300, octaves: 3 }).start(); swish.chain(swf, M.cueVerb); swish.volume.value = -10;
    const tick = new T.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.01, sustain: 0 } });
    const tf = new T.Filter({ type: "bandpass", frequency: 3000, Q: 6 }); tick.chain(tf, M.cues); tick.volume.value = -12;
    const rattle = new T.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.03, sustain: 0 } });
    const rf = new T.Filter({ type: "bandpass", frequency: 2500, Q: 2 }); rattle.chain(rf, M.cues); rattle.volume.value = -4;
    return (C = { soft, thud, bell, swish, swf, tick, tf, rattle, rf });
  }
  const degreeNote = (n) => { const sc = mode[2]; return mode[3] + sc[(n - 1) % 7] + (n > 7 ? 12 : 0); };
  function cue(name, a, b) {
    if (!M || !awake) return;
    const c = cuesBuilt(), t = now() + 0.03;
    switch (name) {
      case "rise": {                                            // the options rising, one note each, climbing
        const n = Math.max(1, Math.min(9, a || 3)), gap = Math.max(0.08, (b || 250) / 1000);
        for (let i = 0; i < n; i++) c.soft.triggerAttackRelease(mtof(degreeNote(1 + i) + 12), 0.2, t + i * gap, 0.35);
        break;
      }
      case "lock": c.thud.triggerAttackRelease("C2", 0.2, t, 0.5); c.swish.triggerAttackRelease(0.6, t, 0.4); break;
      case "rattle":                                            // the screen's throw (a real die makes its own sound)
        { let u = t; for (let i = 0; i < 14; i++) { u += rnd(0.02, 0.05); c.rf.frequency.setValueAtTime(rnd(1800, 3800), u); c.rattle.triggerAttackRelease(0.02, u, rnd(0.4, 1)); } }
        break;
      case "land": {                                            // the number: each has its own note; then hit (a fifth) or miss (a rub)
        const n = Math.max(1, Math.min(6, a || 1)), f = mtof(degreeNote(n) + 12);
        c.thud.triggerAttackRelease("G1", 0.3, t, 0.7);
        c.bell.triggerAttackRelease(f, 1.2, t + 0.05, 0.6);
        if (b === true) c.soft.triggerAttackRelease([f, f * 1.5], 1.2, t + 0.75, 0.45);
        else if (b === false) c.soft.triggerAttackRelease([f, f * 1.06], 1.2, t + 0.75, 0.35);
        break;
      }
      case "year": c.tf.frequency.setValueAtTime(rnd(2800, 3400), t); c.tick.triggerAttackRelease(0.01, t, 0.5); break;
      case "arrive": c.swish.triggerAttackRelease(Math.max(0.6, (a || 2000) / 2000), t, 0.5); break;
      case "bell": c.bell.triggerAttackRelease(mtof(degreeNote(5) + 12), 2, t, 0.5); break;
    }
  }

  // ======================================================================== the moments
  function age(a) {
    lifeAge = Math.max(0, +a || 0);
    const m = modeAt(lifeAge), changed = m !== mode;
    mode = m;
    if (bedOn) nextChord(changed ? 8 : 6);
  }
  function mood(kind) {
    stat.mood = kind;
    colour = kind === "hit" || kind === "good" ? 1 : kind === "miss" || kind === "bad" ? -1 : 0;
    if (bedOn) nextChord(4);
    const heavier = kind === "bad" || kind === "miss";        // the place leans with it a little
    if (M) M.place.volume.rampTo(mix.place + (heavier ? 1.5 : 0), 3);
  }
  function wake(ms = 3000) {
    build(); awake = true; levelMaster(ms / 1000);
    startBed();
    if (pending) scene(pending[0], ms, pending[1]);
    later(300, () => cue("arrive", ms));
  }
  function sleepAll(ms = 2500) {                                // the screen goes black: silence
    awake = false; levelMaster(ms / 1000);
    later(ms + 200, () => { if (!awake) { stopBed(0.1); clearPlace(0.1); } });
  }
  function end(ms = 8000) {                                     // death: the bed lets go, the place thins out to nothing
    stopBed(ms / 1000);
    clearPlace(ms / 1000);
  }
  function duck(on) {
    stat.ducked = !!on;
    if (!M) return;
    M.duckBus.gain.cancelScheduledValues(now());
    M.duckBus.gain.rampTo(on ? T.dbToGain(-mix.duck) : 1, on ? 0.25 : 0.9);
  }
  function pause(on) { paused = !!on; levelMaster(on ? 0.5 : 1.2); }
  function level() { return M ? M.master.gain.value : 0; }

  return { unlock, wake, sleep: sleepAll, age, scene, mood, cue, duck, pause, end, setMix, level, stat, tagsFor, kits: KITS,
           _debug: () => ({ M, mix, playing: playing.map(k => k.name), mode: mode[1], colour, awake }) };
}

function stub(stat) {                                           // no Tone.js: everything does nothing, quietly
  const f = () => {};
  return { unlock: f, wake: f, sleep: f, age: f, scene: f, mood: f, cue: f, duck: f, pause: f, end: f, setMix: f, level: () => 0, stat, tagsFor, kits: KITS };
}
