// The ever-changing world's clock (web/worldclock.js) against a fake painter: it shows pictures on its own rhythm,
// holds still when it must (pause, the die, a change), survives a failing painter, never repeats back to back,
// and gives back every picture it doesn't show.
import { createWorldClock } from "../../web/worldclock.js";
import C from "../lib/check.js";
const { check, note, done } = C;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let id = 0, failNext = 0, closed = 0, made = 0;
const shown = [];
const live = {
  async paintShot(prompt, seed, { signal } = {}) {
    await sleep(40 + Math.random() * 60);
    if (signal && signal.aborted) return null;
    if (failNext > 0) { failNext--; return null; }
    made++; return { img: { close() { closed++; } }, depth: null, id: ++id, prompt };
  },
  dropShot(sh) { if (sh) sh.img.close(); },
  showShot(sh, o) { shown.push({ prompt: sh.prompt, o }); sh.img.close(); return sleep(Math.min(o.fade, 40)).then(() => true); },
  worldBusy: () => false,
};
const st = { paused: false, screenUp: true, held: false, covered: false, picking: false, tempo: 0.4, light: "warm afternoon light",
             place: "in a small town", means: "", shotMin: 1, shotMax: 3, weather: [] };
const clock = createWorldClock({ live, sound: { scene() {} }, sleep, state: () => st });
clock.life(4242); clock.run(true);
const ev = { scene: "a school classroom, rows of wooden desks", passage: ["a dusty playground at noon", "a bus stop in the rain"],
  objects: ["a tiffin box open on a desk", "chalk dust on a blackboard ledge", "a school bag on a hook"], people: ["children running across a playground"],
  intrusions: ["a power cut, a candle on a window sill"], weather: [], ageNow: 8, dur: 200 };
check(await clock.arrive(ev), "the arrival shot didn't come in");
check(/^wide view of a school classroom/.test(shown[0] && shown[0].prompt), "the arrival isn't a wide shot of the scene: " + (shown[0] && shown[0].prompt));
await sleep(5000);
const n1 = shown.length;
check(n1 >= 3, `too few pictures in 5 s at tempo 0.4 (${n1})`);
st.paused = true; const a = shown.length; await sleep(2000); check(shown.length - a <= 1, `pictures kept coming while paused (+${shown.length - a})`); st.paused = false;
st.held = true; const b = shown.length; await sleep(2000); check(shown.length - b <= 1, `pictures kept coming while the die rolled (+${shown.length - b})`); st.held = false;
const c0 = shown.length, o = clock.outcome(sleep(600).then(() => true), { scene: "an art room with easels", passage: ["an art college corridor"], mood: "the air clear" });
await sleep(400); check(shown.length - c0 === 0, "a picture came in while the outcome was being painted");
await o; await sleep(3000); check(shown.length > c0, "nothing after the outcome");
failNext = 8; const f0 = shown.length; await sleep(4000);
check(clock.stat.failed >= 1, "the failures weren't counted"); note(`a failing painter: ${clock.stat.failed} failed, ${shown.length - f0} still shown (the screen keeps the last picture)`);
failNext = 0; await sleep(4000); check(clock.stat.failed < 30, "it hammered a failing painter instead of backing off");
const prompts = shown.map(s => s.prompt);
let same = 0; for (let i = 1; i < prompts.length; i++) if (prompts[i] === prompts[i - 1]) same++;
check(same === 0, `${same} identical pictures back to back`);
const kinds = new Set(shown.map(s => s.o.fade < 100 ? "cut" : s.o.fade < 1000 ? "quick" : "slow"));
check(kinds.size >= 2, "only one kind of transition: " + [...kinds]);
check(prompts.every(p => p.split(/\s+/).length <= 60), "a prompt is longer than 60 words");
clock.stop(); await sleep(400);
check(clock.stat.queue === 0, "pictures left waiting after the life ended");
// rolls on their own
const c2 = createWorldClock({ live, sleep, state: () => st }); c2.life(7); c2.know({ scene: "x" }); c2.stop();
const g = []; for (let i = 0; i < 2000; i++) g.push(c2._roll.gap()); g.sort((x, y) => x - y);
note(`gap rolls (s, before tempo): p10 ${g[200].toFixed(1)} · median ${g[1000].toFixed(1)} · p90 ${g[1800].toFixed(1)}`);
check(g[1000] > 0.8 && g[1000] < 3, "the median gap is out of range");
const same1 = createWorldClock({ live, sleep, state: () => st }), same2 = createWorldClock({ live, sleep, state: () => st });
same1.life(99); same2.life(99); same1.know({ scene: "a street", objects: ["a cup", "a key"] }); same2.know({ scene: "a street", objects: ["a cup", "a key"] }); same1.stop(); same2.stop();
check([1, 2, 3, 4, 5].every(() => same1._roll.gap() === same2._roll.gap()), "the same seed didn't roll the same");
note(`${shown.length} pictures shown, ${closed} given back`);
done("world clock");
