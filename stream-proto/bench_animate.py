"""
Speed check for the animation layer, on the GPU machine:   python bench_animate.py [portrait.jpg] [driving.mp4]
Moves a portrait with a recorded face (LivePortrait's own examples by default), frame by frame exactly as the
server does for the browser, and prints how long each part takes. No browser or network involved: this is the
server's share of the round trip. Writes bench_animate.jpg (driving frames over animated frames) to look at.
"""
import os
import statistics
import sys
import time

import cv2
import numpy as np

from animate import LP_DIR, Animator

src_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(LP_DIR, "assets/examples/source/s0.jpg")
drv_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(LP_DIR, "assets/examples/driving/d0.mp4")

t0 = time.perf_counter()
A = Animator()
print(f"loaded in {time.perf_counter() - t0:.1f} s on {A.w.device}")

src = cv2.cvtColor(cv2.imread(src_path), cv2.COLOR_BGR2RGB)
t0 = time.perf_counter()
ok = A.set_source(src)
print(f"portrait {src.shape[1]}x{src.shape[0]}: face {'found' if ok else 'NOT FOUND'} in {(time.perf_counter() - t0) * 1000:.0f} ms")
if not ok:
    sys.exit(1)

cap, frames = cv2.VideoCapture(drv_path), []
N = int(os.environ.get("BENCH_FRAMES", "160"))
while len(frames) < N:
    ok, f = cap.read()
    if not ok:
        break
    f = cv2.resize(f, (480, int(480 * f.shape[0] / f.shape[1])))            # what the browser sends: 480 wide, jpeg
    frames.append(cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, 80])[1].tobytes())
print(f"{len(frames)} driving frames from {os.path.basename(drv_path)}")

parts, sheet = {}, []
for i, jpeg in enumerate(frames):
    out, info = A.drive_jpeg(jpeg)
    if i < min(15, N // 4):                                                    # warm-up
        continue
    for k, v in info["ms"].items():
        parts.setdefault(k, []).append(v)
    if i % max(1, N // 6) == 0 and len(sheet) < 5:
        d = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        o = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_COLOR)
        d = cv2.resize(d, (256, int(256 * d.shape[0] / d.shape[1])))
        o = cv2.resize(o, (256, int(256 * o.shape[0] / o.shape[1])))
        sheet.append(np.vstack([cv2.copyMakeBorder(d, 0, max(0, 256 - d.shape[0]), 0, 0, cv2.BORDER_CONSTANT), o[:256]]))

print("\nper frame, median (ms):")
for k in ("track", "motion", "warp", "paste", "jpeg", "total"):
    if k in parts:
        print(f"  {k:7s} {statistics.median(parts[k]):6.1f}")
tot = statistics.median(parts["total"])
print(f"\n=> about {1000 / tot:.0f} frames a second from the server alone; the tunnel and the browser add to the round trip.")
if sheet:
    cv2.imwrite("bench_animate.jpg", np.hstack(sheet))
    print("wrote bench_animate.jpg (top: driving face, bottom: animated portrait)")
