"""The avatar's face doesn't distort: animate.Steady between the tracker and the warp, fed made-up tracker data.
A slipped frame is held, not drawn; a huge expression eases off; a neutral caught mid-word drifts back; ordinary
movement passes through. (The real warp needs the GPU: this tests what goes into it.)   python steady.test.py"""
import os, sys
try:
    import torch
except ImportError:
    print("SKIP face (no torch on this computer: run it on the GPU machine)"); sys.exit(0)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
import animate
from animate import Steady

fails = []
def check(ok, msg):
    if not ok: fails.append(msg)

torch.manual_seed(1)
OPTS = {"smooth": 0.3, "face_smooth": 0.3, "turn_limit": 22, "face_limit": animate.EXP_LIMIT}
def pose(yaw=0.0, pitch=0.0, roll=0.0, exp=None, noise=0.0):
    e = torch.zeros(1, 21, 3) if exp is None else exp.clone()
    if noise: e = e + torch.randn_like(e) * noise
    return {"pitch": torch.tensor([pitch + (torch.randn(1).item() * noise * 20 if noise else 0)]),
            "yaw": torch.tensor([yaw]), "roll": torch.tensor([roll]),
            "t": torch.zeros(1, 3), "scale": torch.ones(1, 1), "exp": e}

# 1. ordinary movement passes: a head turning 15 degrees over 30 frames, never held
s = Steady(torch.tanh)
held = 0
for i in range(30):
    out = s.step(pose(yaw=i * 0.5, noise=0.002), OPTS)
    held += out is None
check(held == 0, f"ordinary movement was held {held} times")
check(abs(float(out["ang"]["yaw"]) - 14) < 4, f"a 15 degree turn came out as {float(out['ang']['yaw']):.1f}")

# 2. a slipped frame (the tracker jumps 60 degrees and the face goes wild for one frame) is held, then it carries on
s = Steady(torch.tanh)
for i in range(10): s.step(pose(noise=0.002), OPTS)
wild = s.step(pose(yaw=60, exp=torch.full((1, 21, 3), 0.3)), OPTS)
check(wild is None, "a 60 degree jump in one frame was drawn")
back = s.step(pose(noise=0.002), OPTS)
check(back is not None and abs(float(back["ang"]["yaw"])) < 3, "after a slipped frame it didn't carry on from where it was")

# 3. ...but a real new pose that lasts is believed after a few frames (it never freezes)
s = Steady(torch.tanh)
for i in range(10): s.step(pose(), OPTS)
outs = [s.step(pose(yaw=40), OPTS) for _ in range(animate.HOLD_MAX + 3)]
check(any(o is not None for o in outs), "a pose that lasted was never believed (frozen)")

# 4. a huge expression (a yawn, a hand over the mouth) eases off: never more than the limit
s = Steady(torch.tanh)
for i in range(10): s.step(pose(), OPTS)
big = torch.zeros(1, 21, 3); big[0, 14:21, :] = 0.4                    # mouth points, way out
for i in range(1, 12): out = s.step(pose(exp=big * i / 11), OPTS) or out   # (grows over 11 frames: not a glitch)
m = float(out["exp"].abs().max())
check(m <= animate.EXP_LIMIT + 1e-6, f"a huge expression reached {m:.3f} (limit {animate.EXP_LIMIT})")
check(m > animate.EXP_LIMIT * 0.6, f"a huge expression was flattened to {m:.3f}: the face would look dead")

# 5. a small expression (a smile) passes almost unchanged
s = Steady(torch.tanh)
for i in range(10): s.step(pose(), OPTS)
smile = torch.zeros(1, 21, 3); smile[0, 14:21, 1] = 0.02
for i in range(12): out = s.step(pose(exp=smile), OPTS)
got = float(out["exp"][0, 14:21, 1].mean())
check(abs(got - 0.02) < 0.004, f"a small smile came out as {got:.4f} (wanted ~0.02)")

# 6. a neutral caught mid-word drifts back to the resting face (the portrait doesn't keep a bent mouth all night)
s = Steady(torch.tanh)
talk = torch.zeros(1, 21, 3); talk[0, 14:21, 1] = 0.05
s.step(pose(exp=talk), OPTS)                                            # the first frame: mouth open
first = None
for i in range(1500):                                                   # then a minute of resting face
    out = s.step(pose(), OPTS)
    if i == 5: first = float(out["exp"].abs().max())
last = float(out["exp"].abs().max())
check(first > 0.03, f"(test) the bad neutral didn't show at first ({first:.3f})")
check(last < 0.005, f"a neutral caught mid-word still bends the face after a minute: {last:.4f}")

# 7. a big turn eases off at the limit instead of bending the painting
s = Steady(torch.tanh)
for i in range(10): s.step(pose(), OPTS)
for i in range(1, 30): out = s.step(pose(yaw=min(80, i * 4)), OPTS) or out
check(abs(float(out["ang"]["yaw"])) <= 28, f"an 80 degree turn reached {float(out['ang']['yaw']):.1f}")   # (22 + the neutral's slow drift)

if fails:
    print("FAIL face (steadying)"); [print("   x " + f) for f in fails]; sys.exit(1)
print("PASS face (steadying: glitches held, big faces eased, neutral drifts back)")
