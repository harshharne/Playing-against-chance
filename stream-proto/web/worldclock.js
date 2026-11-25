// The ever-changing world: chance sets what the background shows, how it is seen, and when it changes.
//
// Every picture is painted on its own, from its own noise (live.paintShot): nothing is held over from the last one.
// What keeps one life looking like one life is the look (the LoRA) and the life's own things: its places, its objects,
// its people, the light of its age. What makes it alive is that none of it is predictable:
//   WHAT     a fragment, rolled from the event's POOL: a place, an object, people, the weather, something from outside
//            the life (an INTRUSION of the times), or a MEMORY (an earlier moment, coming back; more often as you age)
//   HOW      a shot, rolled: wide, close-up, a detail, from above, through a window, a reflection, a silhouette,
//            empty, crowded, from low down
//   LIGHT    the time and the weather, rolled; the light of your age most of the time (a life as one day)
//   WHEN     the gap before the next picture, rolled: mostly a few seconds, sometimes a burst of quick ones, sometimes
//            a long hold. Slower while you choose; frozen while the die rolls; nothing while paused or dark.
//   CHANGE   cut, quick dissolve or a slow patchy one, rolled
//   MOVE     each picture drifts on its own while it is up (a push in, a pull out, a slide), rolled
// Pictures are painted AHEAD (a few, full quality) and shown when their time comes; the one on screen stays until the
// next is ready, so the screen is never blank and never shows a rough picture. One random.org draw seeds every roll.
//
//   const clock = createWorldClock({ live, sound, sleep, state, compose })
//   clock.life(seed)                 a new life: everything forgotten, every roll seeded from this
//   clock.arrive(ev, { scene, directed, dur, pool, passage, age, sounds })   arriving at an event: a wide shot of its
//                                    scene comes in slowly over the arrival; then the pool is the event's -> Promise
//   clock.outcome(promise, { scene, passage, mood, pool })   the world turns into what happened (painted by the game as
//                                    a change from the picture on screen): the clock waits for it, then goes on from it
//   clock.run(on)                    ever-changing on / off (off: the clock lets go of the screen, paints nothing)
//   clock.stop()                     the life is over: nothing more is painted
//   clock.stat                       for the D line and the panel

const SHOTS = {                     // how a fragment is seen. w = how often; fits = which kinds of fragment it suits
  wide:       { w: 3,   fits: "place weather intrusion memory people", words: s => `wide view of ${s}` },
  close:      { w: 2,   fits: "object people place",                   words: s => `close-up of ${s}` },
  detail:     { w: 1.6, fits: "object place memory",                   words: s => `detail of ${s}, shallow focus` },
  above:      { w: 1,   fits: "place people object intrusion",         words: s => `${s}, seen from above` },
  window:     { w: 1.1, fits: "place weather people intrusion",        words: s => `${s}, seen through a window` },
  reflection: { w: 0.7, fits: "place weather people",                  words: s => `${s}, reflected in glass` },
  silhouette: { w: 0.8, fits: "people place intrusion",                words: s => `${s} in silhouette against the light` },
  empty:      { w: 0.9, fits: "place memory",                          words: s => `${s}, empty, no one there` },
  crowd:      { w: 0.8, fits: "place intrusion people",                words: s => `${s}, crowded with people` },
  low:        { w: 0.8, fits: "place object people",                   words: s => `low view from the ground, ${s}` },
};
const KIND_W = { place: 3, object: 2, people: 1.5, weather: 0.8, intrusion: 0.9 };   // memory: grows with age (below)
const TIMES = ["dawn", "early morning", "noon", "afternoon", "golden hour", "dusk", "night, street lights", "late at night"];
const WEATHER = ["light rain", "heavy rain", "mist", "dust in the air", "wet streets after rain", "harsh sun, heat haze",
                 "strong wind", "overcast, flat grey light", "winter haze"];
const TRANS = [["cut", 25], ["quick", 45], ["slow", 30]];       // how a picture comes in (percent)
const AHEAD = 2;                                                 // pictures painted ahead of the screen
const REPEAT = 8;                                                // a fragment doesn't come back within this many pictures

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clean = s => String(s || "").replace(/\s+/g, " ").replace(/^[\s,]+|[\s,.]+$/g, "").trim();
const SUBJECT_WORDS = 22;            // a fragment's words at most: the prompt stays short (the painter reads ~77 tokens)
const clip = s => { const w = clean(s).split(" "); return clean(w.length > SUBJECT_WORDS ? w.slice(0, SUBJECT_WORDS).join(" ") : w.join(" ")); };

export function createWorldClock({ live, sound = null, sleep, state, compose = null }) {
  let rng = Math.random, on = false, alive = false, gen = 0;
  let pool = [], past = [], recent = [], lastShot = "", mood = "", moodLeft = 0, age = 0;
  let usedOut = new Set();             // the times coming in from outside (intrusions): each once a life, while there are others
  let queue = [];                    // { sh (painted) | null, p (promise), ctl, prompt, frag, shot, gen }
  let gate = Promise.resolve(), gateOpen = true, burst = 0, nextAt = 0, fails = 0, arriving = null;
  const stat = { mode: "off", shown: 0, painted: 0, failed: 0, dropped: 0, queue: 0, last: "", gap: 0, wait: "" };
  const R = () => rng();
  const pick = (list) => list[Math.floor(R() * list.length)];
  function weighted(items) {                                     // [[value, weight], ...]
    const tot = items.reduce((t, [, w]) => t + Math.max(0, w), 0);
    let r = R() * tot;
    for (const [v, w] of items) { r -= Math.max(0, w); if (r <= 0) return v; }
    return items.length ? items[items.length - 1][0] : null;
  }

  // ---------- what, how, and in what light ----------
  function rollFragment() {
    const recentSet = new Set(recent);
    const byKind = {};
    for (const f of pool) (byKind[f.kind] = byKind[f.kind] || []).push(f);
    if (past.length > 1) byKind.memory = past.slice(0, -1).map(t => ({ kind: "memory", text: t }));
    const kinds = Object.keys(byKind).map(k => [k, k === "memory" ? 0.15 + Math.min(1.4, age / 55) : (KIND_W[k] || 1)]);
    for (let tries = 0; tries < 6; tries++) {
      const k = weighted(kinds); if (!k) break;
      let fresh = byKind[k].filter(f => !recentSet.has(f.text));
      if (k === "intrusion") { const unseen = fresh.filter(f => !usedOut.has(f.text)); if (unseen.length) fresh = unseen; }
      if (fresh.length) return pick(fresh);
    }
    const any = pool.filter(f => !recentSet.has(f.text));
    return any.length ? pick(any) : pool.length ? pick(pool) : null;
  }
  function rollShot(kind) {
    const fit = Object.entries(SHOTS).filter(([n, s]) => s.fits.includes(kind) && n !== lastShot);
    return weighted(fit.map(([n, s]) => [n, s.w])) || "wide";
  }
  function rollLight() {
    const st = state();
    const parts = [];
    if (st.light && R() < 0.92) parts.push(st.light);           // the light of your age, nearly always (the time of day
    else parts.push(pick(TIMES));                               // doesn't jump about from one picture to the next)
    if (R() < 0.35) parts.push(pick(st.weather && st.weather.length ? st.weather : WEATHER));
    return parts;
  }
  function promptFor(frag, shot, { light = null } = {}) {
    const st = state();
    let subject = clip(frag.text);
    if (frag.kind === "memory") subject = `${subject}, ${pick(["years later", "as remembered", "older now", "long after"])}`;
    const parts = [SHOTS[shot] ? SHOTS[shot].words(subject) : subject];
    // WHERE: the region always (things and people look like they belong there); its scenery (towers, palm trees, the
    // sea) only on pictures of places, and not every time, so a rattle never gets palm trees and a life isn't all neon
    const [region, ...scenery] = String(st.place || "").split(",").map(clean).filter(Boolean);
    const isPlace = /^(place|weather|intrusion)$/.test(frag.kind) && !/^(close|detail)$/.test(shot);
    if (region) parts.push(region);                            // (before the light: if anything is cut off at the end, it isn't where)
    if (isPlace && scenery.length && R() < 0.6) parts.push(scenery.join(", "));
    let lt = (light || rollLight()).slice();
    if (st.lightWords && st.lightWords.test(subject)) lt = lt.filter(w => !TIMES.includes(w) && w !== st.light);   // it names its own light
    const wx = st.weather && st.weather.length ? st.weather : WEATHER;
    if (frag.kind === "weather" && !lt.some(w => wx.includes(w))) lt.push(pick(wx));
    if (mood && moodLeft > 0 && R() < 0.5) parts.push(...lt.filter(w => !wx.includes(w)), mood);   // after an outcome, its air (not a rival sky)
    else parts.push(...lt);
    if (st.means && isPlace) parts.push(st.means);            // what the family had: on the places of a childhood only
    return parts.map(clean).filter(Boolean).join(", ");
  }
  function rollMove() {
    const how = weighted([["in", 3], ["out", 2], ["slide", 3], ["rise", 1], ["still", 0.6]]);
    const s = R() < 0.5 ? -1 : 1, T = 9000 + R() * 16000;
    switch (how) {
      case "in":    return { z0: 0, z1: 0.6 + R() * 0.4, x0: 0, x1: (R() - 0.5) * 0.6, y0: 0, y1: 0, T };
      case "out":   return { z0: 0.6 + R() * 0.4, z1: 0, x0: (R() - 0.5) * 0.6, x1: 0, y0: 0, y1: 0, T };
      case "slide": return { z0: 0.25, z1: 0.3, x0: -s * (0.5 + R() * 0.5), x1: s * (0.5 + R() * 0.5), y0: 0, y1: 0, T };
      case "rise":  return { z0: 0.3, z1: 0.35, x0: 0, x1: 0, y0: s * 0.8, y1: -s * 0.8, T };
      default:      return { z0: 0.1, z1: 0.18, x0: 0, x1: (R() - 0.5) * 0.3, y0: 0, y1: 0, T };
    }
  }
  function rollTransition(quickRun) {
    const kind = quickRun ? weighted([["cut", 60], ["quick", 40]]) : weighted(TRANS);
    if (kind === "cut") return { kind, fade: 90, ease: "lin", wet: 0 };
    if (kind === "quick") return { kind, fade: 450 + R() * 500, ease: "inout", wet: 0.15 };
    return { kind, fade: 1800 + R() * 1800, ease: "inout", wet: 0.85 };
  }
  function rollGap() {                                           // seconds until the next picture, before tempo
    const st = state(), lo = Math.max(0.8, st.shotMin || 2), hi = Math.max(lo + 0.5, st.shotMax || 10);
    if (burst > 0) { burst--; return lo * (0.6 + R() * 0.6); }
    const r = R();
    if (r < 0.14) { burst = 1 + Math.floor(R() * 3); return lo * (0.6 + R() * 0.6); }   // a burst: a few in quick succession
    if (r < 0.26) return hi * (1.2 + R() * 0.8);                                          // a long hold
    return lo + (hi - lo) * Math.pow(R(), 1.6);                                             // mostly short, sometimes longer
  }

  // ---------- painting ahead ----------
  function dropQueue(keep = null) {                              // keep(q): which waiting pictures are still wanted
    const kept = [];
    for (const q of queue.splice(0)) {
      if (keep && keep(q)) { q.gen = gen; kept.push(q); continue; }
      q.ctl.abort(); if (q.sh) { live.dropShot(q.sh); stat.dropped++; }
    }
    queue.push(...kept);
    stat.queue = queue.length;
  }
  const STILL_TRUE = q => /^(object|people|intrusion|memory)$/.test(q.frag.kind);   // an outcome changes the place, not these
  function blocked() {                                            // nothing may change on screen now
    const st = state();
    if (!on || !alive) return "off";
    if (st.paused) return "paused";
    if (!st.screenUp) return "dark";
    if (st.held) return "the die";
    if (st.covered) return "drawn scene";
    if (!gateOpen) return "a change";
    if (live.worldBusy()) return "a change";
    if (arriving) return "arriving";
    return "";
  }
  function paintOne() {
    const frag = rollFragment();
    if (!frag) return null;
    const shot = rollShot(frag.kind);
    recent.push(frag.text); while (recent.length > REPEAT) recent.shift();
    if (frag.kind === "intrusion") usedOut.add(frag.text);
    const prompt = promptFor(frag, shot);
    const ctl = new AbortController(), my = gen;
    const q = { sh: null, ctl, prompt, frag, shot, gen: my, done: false, seed: 1 + Math.floor(R() * 1e9) };
    q.p = live.paintShot(prompt, q.seed, { signal: ctl.signal }).then(sh => {
      q.done = true;
      if (q.gen !== gen || ctl.signal.aborted) { if (sh) live.dropShot(sh); return; }
      if (!sh) { fails++; stat.failed++; const i = queue.indexOf(q); if (i >= 0) queue.splice(i, 1); stat.queue = queue.length; return; }
      fails = 0; q.sh = sh; stat.painted++;
    });
    queue.push(q); stat.queue = queue.length;
    return q;
  }
  async function painter(my) {                                   // keeps AHEAD pictures painted or on their way
    while (my === gen) {
      try {
        const st = state();
        if (on && alive && pool.length && !st.paused && !st.covered) {      // (while dark too: the first ones are ready when it lights)
          // (one ahead while a turn may come any moment: what's painted for this pool would be thrown away)
          const ahead = st.picking || st.throwing ? 1 : AHEAD;
          if (queue.length < ahead && (fails === 0 || performance.now() > backoffUntil)) {
            paintOne();
            if (fails > 0) backoffUntil = performance.now() + Math.min(15000, 1000 * Math.pow(2, Math.min(4, fails - 1)));
          }
        }
      } catch (e) { console.warn("[worldclock] painter", e); }
      await new Promise(r => setTimeout(r, 200));
    }
  }
  let backoffUntil = 0;

  // ---------- showing ----------
  async function shower(my) {
    let lastGapAt = performance.now(), want = 0;
    while (my === gen) {
      try {
        await new Promise(r => setTimeout(r, 120));
        if (my !== gen) break;
        const why = blocked();
        stat.wait = why;
        const st = state(), now = performance.now();
        // the clock runs only while the world may move; slower while you choose, at the panel's tempo
        if (why) { lastGapAt = now; continue; }
        if (!want) { want = rollGap(); stat.gap = Math.round(want * 10) / 10; }
        const rate = (st.picking ? 1 / 1.8 : 1) / Math.max(0.4, st.tempo || 1);
        nextAt += (now - lastGapAt) * rate; lastGapAt = now;
        if (nextAt < want * 1000) continue;
        const q = queue.find(x => x.sh);                         // the first painted one, in order
        if (!q) { stat.wait = queue.length ? "painting" : "nothing to paint"; continue; }   // not ready: the picture on screen stays
        queue.splice(queue.indexOf(q), 1); stat.queue = queue.length;
        const tr = rollTransition(burst > 0), mv = rollMove();
        const quick = tr.kind === "cut";
        lastShot = q.shot;
        // the sound follows a new PLACE (a close-up of a cup keeps the room's sound; so do people and memories)
        const tags = q.frag.sound && q.frag.sound.length ? q.frag.sound : null;
        if (sound && (tags || /^(place|weather|intrusion)$/.test(q.frag.kind))) sound.scene(q.frag.text, Math.max(1500, tr.fade * 1.5), tags);
        stat.last = `${q.frag.kind} · ${q.shot} · ${tr.kind}`; stat.prompt = q.prompt; stat.shown++;
        if (moodLeft > 0) moodLeft--;
        nextAt = 0; want = 0;
        const shown = live.showShot(q.sh, { fade: tr.fade, ease: tr.ease, wet: tr.wet, mv });
        q.sh = null;
        if (!quick) await Promise.race([shown, new Promise(r => setTimeout(r, tr.fade + 4000))]);
        lastGapAt = performance.now();
      } catch (e) { console.warn("[worldclock] shower", e); }
    }
  }

  // ---------- the life's moments ----------
  function poolFrom({ scene = "", passage = [], objects = [], people = [], intrusions = [], weather = [], extra = [] } = {}) {
    const out = [], seen = new Set();
    const add = (kind, t, snd) => {
      const text = clip(t);
      if (text && !seen.has(kind + "|" + text)) { seen.add(kind + "|" + text); out.push({ kind, text, sound: Array.isArray(snd) ? snd : null }); }
    };
    add("place", scene);
    for (const p of passage || []) add("place", p);
    for (const o of objects || []) add("object", o);
    for (const p of people || []) add("people", p);
    for (const i of intrusions || []) add("intrusion", i);
    for (const s of (scene ? [scene] : []).concat((passage || []).slice(0, 2))) if ((weather || []).length) add("weather", s);
    for (const f of extra || []) if (f && f.text && (KIND_W[f.kind] !== undefined || f.kind === "memory")) add(f.kind, f.text, f.sound);
    return out;
  }
  function remember(scene) {
    const t = clean(scene);
    const c = clip(t);
    if (c && !past.includes(c)) { past.push(c); if (past.length > 24) past.shift(); }
  }
  function setPool(p) {
    gen++;                                                        // the old pool's pictures in waiting are no longer wanted
    dropQueue();
    pool = p; recent = recent.slice(-3);
    const my = gen; painter(my); shower(my);
  }

  return {
    stat,
    life(seed) {
      gen++; dropQueue();
      rng = mulberry32((Math.floor(+seed) || 1) ^ 0x9E3779B9);
      pool = []; past = []; recent = []; lastShot = ""; mood = ""; moodLeft = 0; age = 0; burst = 0; nextAt = 0; fails = 0; usedOut = new Set();
      gate = Promise.resolve(); gateOpen = true; arriving = null; alive = true;
      Object.assign(stat, { shown: 0, painted: 0, failed: 0, dropped: 0, queue: 0, last: "", gap: 0, wait: "" });
    },
    run(v) { on = !!v; stat.mode = on ? "ever-changing" : "continuous"; if (!on) dropQueue(); },
    get on() { return on; },
    stop() { alive = false; gen++; dropQueue(); },
    // arriving at an event: a wide shot of its scene, painted now (first in line) and brought in slowly
    async arrive({ scene, light = null, dur = 4000, pool: p = null, passage = [], objects = [], people = [], intrusions = [], weather = [], ageNow = 0, sounds = null }) {
      age = ageNow; mood = ""; moodLeft = 0;
      const my = ++gen; dropQueue();
      pool = poolFrom({ scene, passage, objects, people, intrusions, weather, extra: p });
      remember(scene);
      const frag = { kind: "place", text: scene };
      const prompt = promptFor(frag, "wide", { light: light ? [light] : null });
      const token = {}; arriving = token;
      let ok = false;
      try {
        // (the life doesn't wait long for it: if the painter is slow or gone, the picture on screen stays)
        const sh = await live.paintShot(prompt, 1 + Math.floor(R() * 1e9), { timeout: Math.max(8000, dur + 4000) });
        if (my === gen) painter(my);                              // the next ones are painted while this one comes in
        if (sh && my === gen && on && alive) {                    // (its sound: the game's, with the arrival)
          lastShot = "wide"; stat.last = "place · wide · arrival"; stat.prompt = prompt; stat.shown++;
          recent.push(clip(scene));
          ok = await Promise.race([live.showShot(sh, { fade: Math.max(1500, Math.min(9000, dur * 0.7)), ease: "inout", wet: 0.9, mv: rollMove() }),
                                   sleep(Math.max(1500, dur) + 6000).then(() => false)]);
        } else if (sh) live.dropShot(sh);
      } catch (e) { console.warn("[worldclock] arrive", e); }
      if (arriving === token) arriving = null;
      if (my === gen) { nextAt = 0; shower(my); }
      return ok;
    },
    // what happened: the game paints the turn (from the picture on screen); the clock waits, then goes on in its air
    outcome(turned, { scene = "", passage = [], mood: m = "", objects = [], people = [], intrusions = [], weather = [], extra = null } = {}) {
      gateOpen = false;
      const my = ++gen; dropQueue(STILL_TRUE);
      const done = Promise.resolve(turned).catch(() => false).then(ok => {
        if (my !== gen) return ok;
        gateOpen = true; nextAt = 0;
        remember(scene);
        mood = m || ""; moodLeft = mood ? 4 : 0;
        pool = poolFrom({ scene, passage, objects, people, intrusions, weather, extra });
        painter(my); shower(my);
        return ok;
      });
      gate = done;
      return done;
    },
    // continuous rules: the clock only keeps up with the life (so ever-changing can take over at once from the panel)
    know({ scene = "", passage = [], objects = [], people = [], intrusions = [], weather = [], extra = null, ageNow = null } = {}) {
      if (ageNow != null) age = ageNow;
      remember(scene);
      setPool(poolFrom({ scene, passage, objects, people, intrusions, weather, extra }));
    },
    // for tests: the rolls on their own
    _roll: { fragment: rollFragment, shot: rollShot, gap: rollGap, transition: rollTransition, move: rollMove, prompt: promptFor, setRng: f => { rng = f; }, pool: () => pool },
  };
}
