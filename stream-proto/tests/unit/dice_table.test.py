"""The die reader on made-up photos: a whole table seen at an angle (4 corners, t) and a round tray (c).
Every face 1-6 is read on the table, down to a die 24 px across once the table is flattened; the tray still works.
(Real cameras blur: aim for 40+ px.)   python dice_table.test.py"""
import json, os, shutil, subprocess, sys, tempfile
try:
    import cv2, numpy as np
except ImportError:
    print("SKIP dice (no OpenCV on this computer: pip install opencv-python numpy)"); sys.exit(0)

HERE = os.path.dirname(os.path.abspath(__file__))
READER = os.path.join(HERE, "..", "..", "dice_reader.py")
PIPS = {1: [(0.5, 0.5)], 2: [(0.25, 0.25), (0.75, 0.75)], 3: [(0.25, 0.25), (0.5, 0.5), (0.75, 0.75)],
        4: [(0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)], 5: [(0.25, 0.25), (0.75, 0.25), (0.5, 0.5), (0.25, 0.75), (0.75, 0.75)],
        6: [(0.25, 0.22), (0.75, 0.22), (0.25, 0.5), (0.75, 0.5), (0.25, 0.78), (0.75, 0.78)]}
fails = []

def put_die(img, cx, cy, side, n, ang):
    face = np.full((side, side, 3), 235, np.uint8)
    for x, y in PIPS[n]:
        cv2.circle(face, (int(x * side), int(y * side)), max(2, side // 10), (20, 20, 20), -1)
    M = cv2.getRotationMatrix2D((side / 2, side / 2), ang, 1.0)
    face = cv2.warpAffine(face, M, (side, side)); mask = cv2.warpAffine(np.full((side, side), 255, np.uint8), M, (side, side))
    roi = img[cy - side // 2:cy - side // 2 + side, cx - side // 2:cx - side // 2 + side]; roi[mask > 0] = face[mask > 0]

def read(d):
    out = subprocess.run([sys.executable, os.path.join(d, "dice_reader.py"), "--image", os.path.join(d, "die.png"),
                          "--empty", os.path.join(d, "empty.png")], capture_output=True, text=True, timeout=60).stdout
    v = out.split()[1] if out.startswith("value:") else "?"
    return None if v == "None" else int(v) if v.isdigit() else v

with tempfile.TemporaryDirectory() as d:
    shutil.copy(READER, d)
    # the table: 120 x 80 cm, dark wood, seen from the near side (the far edge narrower)
    W, H = 1200, 800
    rng = np.random.default_rng(1)
    wood = np.clip(np.full((H, W, 3), (40, 60, 90), int) + rng.integers(-12, 12, (H, W, 3)), 0, 255).astype(np.uint8)
    cam = np.float32([[560, 260], [1360, 260], [1700, 980], [220, 980]])
    Hm = cv2.getPerspectiveTransform(np.float32([[0, 0], [W, 0], [W, H], [0, H]]), cam)
    json.dump({"quad": cam.tolist(), "size": [W, H], "points": cam.tolist(), "locked": True}, open(os.path.join(d, "tray_area.json"), "w"))
    cv2.imwrite(os.path.join(d, "empty.png"), cv2.warpPerspective(wood, Hm, (1920, 1080), borderValue=(90, 90, 90)))
    for side, where in ((60, (700, 420)), (24, (300, 200)), (30, (1000, 650))):
        got = []
        for n in range(1, 7):
            t = wood.copy(); put_die(t, *where, side, n, 20 + 7 * n)
            cv2.imwrite(os.path.join(d, "die.png"), cv2.warpPerspective(t, Hm, (1920, 1080), borderValue=(90, 90, 90)))
            got.append(read(d))
        if got != [1, 2, 3, 4, 5, 6]:
            fails.append(f"table, die {side}px at {where}: read {got}")
    cv2.imwrite(os.path.join(d, "die.png"), cv2.warpPerspective(wood, Hm, (1920, 1080), borderValue=(90, 90, 90)))
    if read(d) not in (None,):
        fails.append("an empty table was read as a throw")
    # the round tray, as before
    img = np.full((1080, 1920, 3), 15, np.uint8); cv2.ellipse(img, ((960, 560), (900, 600), 0), (25, 25, 25), -1)
    cv2.imwrite(os.path.join(d, "empty.png"), img)
    json.dump({"ellipse": [[960, 560], [900, 600], 0], "points": [], "locked": True}, open(os.path.join(d, "tray_area.json"), "w"))
    for n in (1, 3, 5):
        t = img.copy(); side = 70; face = np.full((side, side, 3), 235, np.uint8)
        for x, y in PIPS[n]: cv2.circle(face, (int(x * side), int(y * side)), 6, (20, 20, 20), -1)
        face = cv2.resize(face, (side, int(side * 0.67))); t[520:520 + face.shape[0], 900:900 + side] = face
        cv2.imwrite(os.path.join(d, "die.png"), t)
        if read(d) != n:
            fails.append(f"the round tray read a {n} as {read(d)}")

if fails:
    print("FAIL dice"); [print("   x " + f) for f in fails]; sys.exit(1)
print("PASS dice (a table seen at an angle: every face, down to 24 px; the round tray as before)")
