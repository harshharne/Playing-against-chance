#!/usr/bin/env python3
"""
dice_reader.py - standalone die reader: angled camera, round tray (Playing Against Chance)

How it reads a throw
  1. You mark the round tray once (click points on its inside edge). Seen at an angle it is
     an oval; the script fits it and flattens it back to a circle. Only the inside counts.
  2. The die is what differs from a photo of the EMPTY tray (or, without that photo,
     whatever is much brighter than the black tray).
  3. The top face is the far end of the die's shape (side faces lie toward the camera).
  4. Only round dark dots on the top face are counted (side-face dots look like ovals).
  5. The count must hold for several still frames; then the throw is saved and logged.

Setup:   pip install opencv-python numpy
Run:     python dice_reader.py --list-cameras     find the overhead camera's number
         python dice_reader.py --camera 1         run live

First run:
  c  define the detection area: click 6-10 points around the INSIDE edge of the tray,
     then press Enter. (r = start again, esc = cancel)
  l  lock the area (press l again to unlock; c does nothing while locked)
  e  take the die OUT and press e to photograph the empty tray (recommended;
     press again if the light changes)
  then throw.

Other keys:  d debug view   s snapshot   q quit
Sliders (window "controls"):
  sensitivity   lower = more counts as "die" (raise if glare or shadows show up)
  dot_dark      % of the die's brightness below which a pixel is a dot (raise if dots are missed)
  dot_round     how oval a dot may be, x10 (lower = stricter against side-face dots)
  area_inset    % of the tray radius that is searched (lower it to skip the tray's rim/wall)
  motion        what counts as movement;  still_frames / confirm_frames  timing

Output: throws/<time>_<value>.mp4 per throw, and throws/log.csv
Test on stills:  python dice_reader.py --image die.jpg [--empty empty.jpg]
"""
import argparse
import csv
import json
import time
from collections import deque
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
AREA_FILE = HERE / "tray_area.json"
EMPTY_FILE = HERE / "tray_empty.png"
OUT_DIR = HERE / "throws"
TRAY = 720                 # the flattened tray image is TRAY x TRAY pixels
R = TRAY // 2 - 8          # tray radius in the flattened image

P = {
    "sensitivity": 28,     # difference from the empty tray that counts as "die"
    "dot_dark": 62,        # dot = darker than this % of the die's face brightness
    "dot_round": 18,       # max dot elongation x10 (1.8)
    "area_inset": 94,      # % of the tray radius that is searched
    "die_min": 2,          # smallest die side, % of tray diameter
    "die_max": 22,         # largest die side, % of tray diameter
    "motion": 6,           # per-mille of pixels changed that counts as movement
    "still_frames": 8,     # still frames before reading
    "confirm_frames": 6,   # identical reads needed
}


# ------------------------------------------------------------------ detection area

def load_area():
    try:
        return json.loads(AREA_FILE.read_text())
    except Exception:
        return None


def save_area(area):
    AREA_FILE.write_text(json.dumps(area))


def area_transform(area):
    """Affine map that turns the tray's oval into a centred circle, far side up."""
    (cx, cy), (w, h), ang = area["ellipse"]
    t = np.radians(ang)
    a1 = np.array([np.cos(t), np.sin(t)]) * w / 2      # fitEllipse: width along angle
    a2 = np.array([-np.sin(t), np.cos(t)]) * h / 2
    major, minor = (a1, a2) if w >= h else (a2, a1)
    if minor[1] > 0:                                    # minor axis = view direction; point it "far" (up)
        minor = -minor
    if major[0] < 0:
        major = -major
    c = np.array([cx, cy])
    src = np.float32([c, c + major, c + minor])
    dst = np.float32([[TRAY / 2, TRAY / 2], [TRAY / 2 + R, TRAY / 2], [TRAY / 2, TRAY / 2 - R]])
    return cv2.getAffineTransform(src, dst)


def flatten(frame, M):
    if M is None:                                       # no area yet: centred square
        h, w = frame.shape[:2]
        s = min(h, w)
        return cv2.resize(frame[(h - s) // 2:(h + s) // 2, (w - s) // 2:(w + s) // 2], (TRAY, TRAY))
    return cv2.warpAffine(frame, M, (TRAY, TRAY))


def area_mask(p=P):
    m = np.zeros((TRAY, TRAY), np.uint8)
    cv2.circle(m, (TRAY // 2, TRAY // 2), int(R * p["area_inset"] / 100), 255, -1)
    return m


def define_area(cap):
    pts = []
    win = "detection area: click 6-10 points on the INSIDE edge of the tray, then Enter"
    cv2.namedWindow(win)
    cv2.setMouseCallback(win, lambda e, x, y, *_: pts.append((x, y)) if e == cv2.EVENT_LBUTTONDOWN else None)
    while True:
        ok, frame = cap.read()
        if not ok:
            continue
        for pt in pts:
            cv2.circle(frame, pt, 5, (0, 255, 255), -1)
        msg = f"{len(pts)} points"
        if len(pts) >= 5:
            e = cv2.fitEllipse(np.array(pts, np.float32))
            cv2.ellipse(frame, e, (0, 255, 0), 2)
            msg += "   Enter = use this   r = restart   esc = cancel"
        else:
            msg += f"   (need {5 - len(pts)} more)   r = restart   esc = cancel"
        cv2.rectangle(frame, (0, 0), (frame.shape[1], 40), (0, 0, 0), -1)
        cv2.putText(frame, msg, (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        cv2.imshow(win, frame)
        k = cv2.waitKey(1) & 0xFF
        if k == ord("r"):
            pts.clear()
        elif k == 27:
            cv2.destroyWindow(win)
            return None
        elif k in (13, 10, 32) and len(pts) >= 5:
            e = cv2.fitEllipse(np.array(pts, np.float32))
            area = {"ellipse": [list(e[0]), list(e[1]), e[2]], "points": pts, "locked": False}
            save_area(area)
            EMPTY_FILE.unlink(missing_ok=True)          # the old empty photo no longer lines up
            cv2.destroyWindow(win)
            print("[area] saved. Check it, then press l to lock it.")
            return area


# ------------------------------------------------------------------ detection core

def find_die(tray, empty, mask, p=P):
    """Die = biggest blob inside the area that differs from the empty tray
    (or, with no empty photo, that is much brighter than the tray)."""
    a = cv2.GaussianBlur(tray, (5, 5), 0)
    if empty is not None:
        diff = cv2.absdiff(a, cv2.GaussianBlur(empty, (5, 5), 0)).max(axis=2)
        fg = diff > p["sensitivity"]
    else:
        g = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
        fg = g > np.median(g[mask > 0]) + 2 * p["sensitivity"]
    fg = (fg & (mask > 0)).astype(np.uint8) * 255
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    contours, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    d = 2 * R
    a_min = (p["die_min"] / 100 * d) ** 2 * 0.6
    a_max = (p["die_max"] / 100 * d) ** 2 * 2.5        # side faces make the blob bigger
    best, best_a = None, 0
    for c in contours:
        ar = cv2.contourArea(c)
        if a_min <= ar <= a_max and ar > best_a:
            best, best_a = c, ar
    filled = np.zeros(fg.shape, np.uint8)
    if best is not None:
        cv2.drawContours(filled, [best], -1, 255, -1)  # fill the dot holes
    return filled, best, fg


def top_face(die_mask, contour):
    """Top face = square at the FAR end of the blob (top of the flattened image).
    A rotated square's bounding box is square, so its height ~ the blob's width."""
    x, y, w, h = cv2.boundingRect(contour)
    top = np.zeros_like(die_mask)
    top[y:y + w, x:x + w] = 255
    top = cv2.bitwise_and(top, die_mask)
    top = cv2.erode(top, np.ones((3, 3), np.uint8))   # drop the shaded rim
    return top, (x, y, w, min(w, h))


def count_dots(gray, top, face_side, p=P):
    pix = gray[top > 0]
    if pix.size < 20:
        return [], np.zeros_like(top)
    ref = np.percentile(pix, 70)                       # brightness of the bare face
    dots = ((gray < ref * p["dot_dark"] / 100) & (top > 0)).astype(np.uint8) * 255
    n, lab, stats, cent = cv2.connectedComponentsWithStats(dots, 8)
    area_face = face_side ** 2
    found = []
    for i in range(1, n):
        ar = stats[i, cv2.CC_STAT_AREA]
        if not (max(4, 0.004 * area_face) <= ar <= 0.09 * area_face):
            continue
        ys, xs = np.nonzero(lab == i)
        if len(xs) < 3:
            continue
        ev = np.sort(np.linalg.eigvalsh(np.cov(np.vstack([xs, ys]))))
        if ev[0] <= 0 or np.sqrt(ev[1] / ev[0]) > p["dot_round"] / 10:
            continue                                   # an oval: side-face dot or grain
        found.append(tuple(cent[i]))
    return found, dots


def read_die(tray, empty, mask, p=P):
    out = {"value": None, "status": "no die", "box": None, "dots": [],
           "fg_mask": None, "dot_mask": None, "contour": None}
    die_mask, contour, fg = find_die(tray, empty, mask, p)
    out["fg_mask"] = fg
    if contour is None:
        return out
    out["contour"] = contour
    top, box = top_face(die_mask, contour)
    out["box"] = box
    dots, dot_mask = count_dots(cv2.cvtColor(tray, cv2.COLOR_BGR2GRAY), top, box[2], p)
    out.update(dots=dots, dot_mask=dot_mask)
    if 1 <= len(dots) <= 6:
        out.update(value=len(dots), status="ok")
    else:
        out["status"] = f"unreadable ({len(dots)} dots)"
    return out


# ------------------------------------------------------------------ live loop

def setup_controls():
    cv2.namedWindow("controls")
    limits = {"sensitivity": 100, "dot_dark": 95, "dot_round": 40, "area_inset": 100,
              "die_min": 20, "die_max": 50, "motion": 100, "still_frames": 30, "confirm_frames": 30}
    for k, mx in limits.items():
        cv2.createTrackbar(k, "controls", P[k], mx, lambda v, k=k: P.__setitem__(k, max(1, v)))


def draw(view, r, state, value, motion, locked, has_area, has_empty):
    col_area = (0, 200, 0) if locked else (0, 165, 255)
    cv2.circle(view, (TRAY // 2, TRAY // 2), int(R * P["area_inset"] / 100), col_area, 1)
    if r["contour"] is not None:
        cv2.drawContours(view, [r["contour"]], -1, (0, 200, 0), 1)
    if r["box"] is not None:
        x, y, w, h = r["box"]
        col = (0, 220, 0) if r["status"] == "ok" else (0, 140, 255)
        cv2.rectangle(view, (x, y), (x + w, y + h), col, 2)
        if r["value"]:
            cv2.putText(view, str(r["value"]), (x + w + 8, y + h // 2 + 10), cv2.FONT_HERSHEY_SIMPLEX, 1.0, col, 2)
    for cx, cy in r["dots"]:
        cv2.circle(view, (int(cx), int(cy)), 4, (0, 0, 255), -1)
    area_txt = "AREA LOCKED" if locked else ("area unlocked (l)" if has_area else "no area (c)")
    top = f"{state}  |  {area_txt}  |  {'empty tray ok' if has_empty else 'no empty photo (e)'}"
    cv2.rectangle(view, (0, 0), (TRAY, 52), (0, 0, 0), -1)
    cv2.putText(view, top, (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
    cv2.putText(view, f"motion {motion:4.1f}   read: {r['status']}", (10, 44),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1)
    if value is not None:
        cv2.putText(view, str(value), (TRAY - 100, TRAY - 25), cv2.FONT_HERSHEY_SIMPLEX, 3.2, (0, 255, 255), 7)


def save_throw(frames, value, status, fps):
    OUT_DIR.mkdir(exist_ok=True)
    name = f"{datetime.now():%Y%m%d-%H%M%S}_{value if value else status}.mp4"
    if frames:
        vw = cv2.VideoWriter(str(OUT_DIR / name), cv2.VideoWriter_fourcc(*"mp4v"),
                             max(5, min(60, round(fps))), (TRAY, TRAY))
        for f in frames:
            vw.write(f)
        vw.release()
    log = OUT_DIR / "log.csv"
    new = not log.exists()
    with log.open("a", newline="") as fh:
        w = csv.writer(fh)
        if new:
            w.writerow(["time", "value", "status", "clip"])
        w.writerow([datetime.now().isoformat(timespec="seconds"), value or "", status, name])
    print(f"[throw] {status}: {value}  -> {name}")


def capture_empty(cap, M, n=12):
    frames = []
    for _ in range(n * 2):
        ok, f = cap.read()
        if ok:
            frames.append(flatten(f, M).astype(np.float32))
        if len(frames) >= n:
            break
    empty = np.mean(frames, axis=0).astype(np.uint8)
    cv2.imwrite(str(EMPTY_FILE), empty)
    print("[empty] empty tray saved. Throw!")
    return empty


def run_live(cam):
    cap = cv2.VideoCapture(cam, cv2.CAP_AVFOUNDATION)
    if not cap.isOpened():
        cap = cv2.VideoCapture(cam)
    if not cap.isOpened():
        raise SystemExit(f"Camera {cam} didn't open. Try --list-cameras, and allow Terminal in "
                         "System Settings > Privacy & Security > Camera.")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)   # more pixels per dot; the camera picks its nearest size
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)

    area = load_area()
    M = area_transform(area) if area else None
    empty = cv2.imread(str(EMPTY_FILE)) if area and EMPTY_FILE.exists() else None
    print("[start]", "press c to define the detection area" if not area else
          "press l to lock the area" if not area.get("locked") else
          "take the die out and press e" if empty is None else "ready, throw")
    setup_controls()

    state, prev, still, value = "IDLE", None, 0, None
    reads, preroll, clip, debug = deque(), deque(maxlen=15), [], False
    t_last, fps = time.time(), 30.0
    while True:
        ok, frame = cap.read()
        if not ok:
            continue
        now = time.time()
        fps = 0.9 * fps + 0.1 / max(1e-3, now - t_last)
        t_last = now

        mask = area_mask()
        tray = flatten(frame, M)
        small = cv2.GaussianBlur(cv2.cvtColor(cv2.resize(tray, (160, 160)), cv2.COLOR_BGR2GRAY), (5, 5), 0)
        small_mask = cv2.resize(mask, (160, 160)) > 0
        motion = 0.0 if prev is None else ((cv2.absdiff(small, prev) > 25) & small_mask).mean() * 1000
        prev = small
        moving = motion > P["motion"]
        r = read_die(tray, empty, mask)

        if state in ("IDLE", "RESULT"):
            preroll.append(tray.copy())
            if moving:
                state, clip, value, still = "ROLLING", list(preroll), None, 0
        elif state == "ROLLING":
            clip.append(tray.copy())
            still = 0 if moving else still + 1
            if still >= P["still_frames"]:
                state, reads = "READING", deque(maxlen=P["confirm_frames"])
        elif state == "READING":
            clip.append(tray.copy())
            if moving:
                state, still = "ROLLING", 0
            else:
                reads.append((r["value"], r["status"]))
                if len(reads) == reads.maxlen:
                    vals = {v for v, _ in reads}
                    stats = [s for _, s in reads]
                    if len(vals) == 1 and None not in vals:
                        value = vals.pop()
                        save_throw(clip, value, "ok", fps)
                        state = "RESULT"
                    elif all(s == "no die" for s in stats):
                        state = "IDLE"            # die taken out: not a throw
                    elif all(s != "ok" for s in stats):
                        save_throw(clip, None, "unreadable", fps)
                        print("        rethrow (or tune dot_dark / sensitivity)")
                        state = "IDLE"
        clip = clip[-450:]                        # ~15 s max

        locked = bool(area and area.get("locked"))
        view = tray.copy()
        draw(view, r, state, value, motion, locked, area is not None, empty is not None)
        cv2.imshow("dice reader (flattened tray)", view)
        if debug:
            raw = frame.copy()
            if area:
                cv2.ellipse(raw, (tuple(area["ellipse"][0]), tuple(area["ellipse"][1]), area["ellipse"][2]),
                            (0, 200, 0) if locked else (0, 165, 255), 2)
            raw = cv2.resize(raw, (640, int(640 * raw.shape[0] / raw.shape[1])))
            fg = r["fg_mask"] if r["fg_mask"] is not None else np.zeros((TRAY, TRAY), np.uint8)
            dm = r["dot_mask"] if r["dot_mask"] is not None else np.zeros((TRAY, TRAY), np.uint8)
            cv2.imshow("debug: camera", raw)
            cv2.imshow("debug: die | dots", np.hstack([cv2.resize(fg, (360, 360)), cv2.resize(dm, (360, 360))]))

        k = cv2.waitKey(1) & 0xFF
        if k == ord("q"):
            break
        elif k == ord("c"):
            if locked:
                print("[area] locked. Press l to unlock first.")
            else:
                new = define_area(cap)
                if new:
                    area, M, empty = new, area_transform(new), None
                    print("[area] now take the die out and press e")
        elif k == ord("l") and area:
            area["locked"] = not area.get("locked")
            save_area(area)
            print("[area]", "locked" if area["locked"] else "unlocked")
        elif k == ord("e"):
            empty = capture_empty(cap, M)
        elif k == ord("d"):
            debug = not debug
            if not debug:
                cv2.destroyWindow("debug: camera")
                cv2.destroyWindow("debug: die | dots")
        elif k == ord("s"):
            OUT_DIR.mkdir(exist_ok=True)
            cv2.imwrite(str(OUT_DIR / f"snap_{datetime.now():%H%M%S}.png"), frame)
            print("[snap] saved raw camera frame")
    cap.release()
    cv2.destroyAllWindows()


def list_cameras():
    for i in range(6):
        cap = cv2.VideoCapture(i, cv2.CAP_AVFOUNDATION)
        if cap.isOpened():
            ok, f = cap.read()
            print(f"camera {i}: " + (f"{f.shape[1]}x{f.shape[0]}" if ok else "opens, no picture"))
        cap.release()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--list-cameras", action="store_true")
    ap.add_argument("--image", help="raw camera photo with the die in it (uses the saved area)")
    ap.add_argument("--empty", help="raw camera photo of the empty tray, same camera position")
    a = ap.parse_args()
    if a.list_cameras:
        return list_cameras()
    if a.image:
        area = load_area()
        M = area_transform(area) if area else None
        img = cv2.imread(a.image)
        emp = cv2.imread(a.empty) if a.empty else None
        if img is None or (a.empty and emp is None):
            raise SystemExit("Couldn't open the image(s).")
        r = read_die(flatten(img, M), flatten(emp, M) if emp is not None else None, area_mask())
        print(f"value: {r['value']}   status: {r['status']}")
        return
    run_live(a.camera)


if __name__ == "__main__":
    main()
