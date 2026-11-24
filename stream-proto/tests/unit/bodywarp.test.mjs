// The body (web/bodywarp.js), the maths: each painted joint lands where the player's says; nothing breaks at the
// limits; jitter is smoothed; a real movement comes through quickly; the painting's arms are only moved when safe.
import { makeRig, bones, bend, createMotion } from "../../web/bodywarp.js";
import C from "../lib/check.js";
const { check, note, done } = C;
const deg = Math.PI / 180;
// a painted half-body: shoulders at 0.33 / 0.67, arms hanging at the sides (screen-left first)
const REST = { ls: [0.33, 0.42, 0.99], rs: [0.67, 0.42, 0.99], le: [0.30, 0.62, 0.95], re: [0.70, 0.62, 0.95], lw: [0.29, 0.80, 0.95], rw: [0.71, 0.80, 0.95] };
const rig = makeRig(REST);
check(rig, "no rig for a plain standing portrait");
check(rig.arms.every(Boolean), "an arm hanging free wasn't rigged: " + rig.why);
let badW = 0; for (let i = 0; i < rig.n; i++) { let s = 0; for (let b = 0; b < 3; b++) s += rig.wts[i * 3 + b]; if (Math.abs(s - 1) > 1e-3) badW++; }
check(badW === 0, `${badW} grid points with weights not adding up to 1`);
check(!makeRig({ ...REST, re: [0.62, 0.55, 0.95], rw: [0.52, 0.62, 0.95] }).arms[1], "an arm folded in front of the body was rigged (it would leave a second arm behind)");
check(!makeRig({ ...REST, re: [0.80, 0.40, 0.95] }).arms[1], "an arm held out sideways was rigged");
check(makeRig({ ...REST, ls: [0.3, 0.4, 0.2] }) === null, "a rig without a seen shoulder");
function live({ tilt = 0, dx = 0, scale = 1, up = [90, 90], fore = [90, 90], hide = [] } = {}) {
  const W = 200 * scale, c = [640 + dx, 360], t = tilt * deg;
  const ls = [c[0] - Math.cos(t) * W / 2, c[1] - Math.sin(t) * W / 2, 0.99], rs = [c[0] + Math.cos(t) * W / 2, c[1] + Math.sin(t) * W / 2, 0.99];
  const arm = (s, u, f, L) => { const e = [s[0] + Math.cos(t + u * deg) * L, s[1] + Math.sin(t + u * deg) * L, 0.95]; return [e, [e[0] + Math.cos(t + f * deg) * L * 0.9, e[1] + Math.sin(t + f * deg) * L * 0.9, 0.95]]; };
  const [le, lw] = arm(ls, up[0], fore[0], 150), [re, rw] = arm(rs, up[1], fore[1], 150);
  const sk = { ls, rs, le, re, lw, rw }; for (const h of hide) sk[h] = [sk[h][0], sk[h][1], 0.1]; return sk;
}
const settle = (m, sk, n = 90) => { for (let i = 0; i < n; i++) m.update(sk, 33); };
function measure(m) {
  const f = bones(rig, m.state), S = [f.body[1](rig.arms[0].S), f.body[1](rig.arms[1].S)], line = Math.atan2(S[1][1] - S[0][1], S[1][0] - S[0][0]), out = { tilt: (line - rig.line) / deg };
  rig.arms.forEach((a, s) => { const E = f.arms[s * 2](a.E), W = f.arms[s * 2 + 1](a.W);
    out["up" + s] = (Math.atan2(E[1] - S[s][1], E[0] - S[s][0]) - line) / deg; out["fore" + s] = (Math.atan2(W[1] - E[1], W[0] - E[0]) - line) / deg; });
  return out;
}
const err = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
for (const [name, spec, want] of [
  ["arms down", {}, { up0: 90, up1: 90 }], ["left arm out", { up: [180, 90], fore: [180, 90] }, { up0: 180, fore0: 180 }],
  ["right arm up", { up: [90, -60], fore: [90, -80] }, { up1: -60, fore1: -80 }], ["forearms across", { up: [100, 80], fore: [10, 170] }, { fore0: 10, fore1: 170 }],
  ["a wave", { up: [90, 20], fore: [90, -90] }, { up1: 20, fore1: -90 }], ["a lean", { tilt: 12 }, { tilt: 11.5 }]]) {
  const m = createMotion(); m.update(live({}), 33); settle(m, live(spec));
  const g = measure(m), worst = Math.max(...Object.entries(want).map(([k, v]) => err(g[k], v)));
  check(worst <= 3, `${name}: off by ${worst.toFixed(1)}°`);
}
{ const m = createMotion(); settle(m, live({ tilt: 40, dx: 500, scale: 2 })); check(Math.abs(m.state.tilt) <= 0.31 && Math.abs(m.state.sway[0]) <= 0.36 && m.state.grow <= 1.11, "the chest went past its limits"); }
{ const m = createMotion(); settle(m, live({ up: [180, -60] })); for (let i = 0; i < 30; i++) m.update(null, 33); const g = measure(m); check(err(g.up0, 102) < 25 && m.state.ok < 0.2, "it didn't go back to rest when the player left"); }
{ const m = createMotion(); const base = live({ up: [90, 120] }); m.update(base, 33); let prev = null, maxStep = 0;
  for (let i = 0; i < 300; i++) { const sk = JSON.parse(JSON.stringify(base)); for (const k in sk) { sk[k][0] += (Math.random() - 0.5) * 12; sk[k][1] += (Math.random() - 0.5) * 12; } m.update(sk, 33); const g = measure(m).up1; if (prev !== null && i > 30) maxStep = Math.max(maxStep, Math.abs(g - prev)); prev = g; }
  note(`camera jitter of ±6 px: the arm moves at most ${maxStep.toFixed(1)}° a frame`); check(maxStep < 3, "too jittery"); }
{ const m = createMotion(); settle(m, live({})); let t = 0; for (; t < 2000; t += 33) { m.update(live({ up: [180, 90], fore: [180, 90] }), 33); if (err(measure(m).up0, 180) <= 9) break; }
  note(`an arm raised 90°: 90 % there after ${t + 33} ms`); check(t + 33 <= 250, "a real movement is too slow"); }
{ const m = createMotion(); settle(m, live({ up: [-170, 10], fore: [-170, 10], tilt: 30, dx: -500, scale: 2 })); const b = bend(rig, m.state); check(![...b.body, ...b.arms[0], ...b.arms[1]].some(v => !isFinite(v)), "NaN in the bent grid"); }
{ const m = createMotion(); settle(m, live({ up: [150, 30] })); const t0 = performance.now(); for (let i = 0; i < 300; i++) bend(rig, m.state); note(`bending the grid: ${((performance.now() - t0) / 300).toFixed(2)} ms a frame`); }
done("body (maths)");
