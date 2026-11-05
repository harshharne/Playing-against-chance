"""
Speed check on the GPU, without the browser. Run inside the venv on the cloud machine:
    PAINTER=sdxl python bench.py      (or without PAINTER=sdxl for the SD 1.5 painter)
Prints the time per avatar frame (by part), per world and per baby portrait, so you know what to expect before playing.
"""
import io
import random
import statistics
import time

from PIL import Image

import stream_server as ss

painter = ss.PAINTER
gen = ss.SDXLGenerator() if painter == "sdxl" else ss.Generator()
ss.gen = gen
ss.dwpose()
cam = Image.new("RGB", (ss.WIDTH, ss.HEIGHT), (128, 110, 95))
jpeg = ss.jpeg_bytes(cam)


def frames(label, n=25, **kw):
    for _ in range(3):
        ss.run_person(jpeg, "a person", **kw)                       # warm up
    times, parts = [], {}
    for _ in range(n):
        _, ms = ss.run_person(jpeg, "a young woman in her twenties, painterly portrait", **kw)
        times.append(ms)
        for k, v in gen.timing.items():
            parts.setdefault(k, []).append(v)
    med = statistics.median(times)
    by = " · ".join(f"{k} {statistics.median(v):.0f}" for k, v in parts.items())
    print(f"  {label:34s} {med:6.0f} ms per frame  ≈ {1000 / med:4.1f} fps on the server   ({by} ms)")


print(f"\npainter {painter} · avatar {ss.WIDTH}x{ss.HEIGHT} · world {ss.WORLD_W}x{ss.WORLD_H} · detection: "
      + (("DWPose on " + ss._wb["where"]) if ss._wb["model"] else "browser MediaPipe"))
for shape in ("off", "depth", "pose", "both"):
    ss.TUNE["shape"] = shape
    frames(f"avatar, shape={shape}")
ss.TUNE["shape"] = "depth"
frames("avatar, age 4 (child pose)", age=4.0, ramp=1.0)
t = time.perf_counter(); ss.run_background("a village by a river at dawn", random.randrange(1 << 30)); w1 = time.perf_counter() - t
t = time.perf_counter(); ss.run_background("the same village at noon", random.randrange(1 << 30), 0.5); w2 = time.perf_counter() - t
t = time.perf_counter(); ss.run_world_depth(ss.world_last["id"]); d = time.perf_counter() - t
print(f"  world, fresh {w1:.2f} s · grown from the last {w2:.2f} s · its depth map {d:.2f} s")
t = time.perf_counter(); ss.run_portrait("a newborn baby girl in a cot", 1, 0, 0.4); p1 = time.perf_counter() - t
t = time.perf_counter(); ss.run_portrait("a newborn baby girl in a cot, green eyes", 1, 1, 0.38); p2 = time.perf_counter() - t
print(f"  baby portrait {p1:.2f} s · a trait emerging {p2:.2f} s")
if gen.gpu_mb():
    print(f"  GPU memory in use: {gen.gpu_mb()[0] / 1000:.1f} of {gen.gpu_mb()[1] / 1000:.1f} GB")
print("\nUnder ~80 ms per frame (12+ fps) the avatar should feel smooth. The network adds its round trip on top.")
