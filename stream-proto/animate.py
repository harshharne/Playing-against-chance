"""
The animation layer: a painted portrait, moved live by the player's face (LivePortrait).

Diffusion paints a still portrait once; this moves it every frame. It never repaints: it warps the pixels the
painter made, so the painting stays as painted. Runs on the GPU machine (chance-rtx), next to stream_server.py.

    Animator()            the real one. Needs LivePortrait cloned to ~/LivePortrait (or LIVEPORTRAIT_DIR) with its
                          weights in ~/LivePortrait/pretrained_weights. setup_liveportrait.sh does both.
    MockAnimator()        no model, for testing the pages on the Mac (MOCK=1): tilts the portrait back and forth.

Both have the same three calls:
    set_source(rgb)       the portrait to move (numpy HxWx3 uint8). False if no face is found in it.
    reset()               the next face seen becomes "neutral": its pose and expression count as no movement.
    drive_jpeg(jpeg)      one camera frame in, (jpeg bytes, info dict) out.

The face DETECTION runs here too (InsightFace + LivePortrait's landmark model, both on the GPU), so the info dict
also says where the player's head is (for the parallax) and whether anyone is there (for the idle screen).
"""
import io
import os
import sys
import threading
import time

import numpy as np

LP_DIR = os.environ.get("LIVEPORTRAIT_DIR", os.path.expanduser("~/LivePortrait"))
LOST_AFTER = 45          # frames without a face before the next face is treated as a new person (new neutral)
MIN_FACE = 0.06          # a face narrower than this share of the camera frame is too small to read (noise): held
JUMP_DEG = 25.0          # a turn this big between two frames is the tracker slipping, not a head: the frame is held
JUMP_EXP = 0.08          # the same for the face (eyes, mouth)
HOLD_MAX = 4             # ...for at most this many frames in a row (then it believes the new pose)
EXP_LIMIT = 0.1          # how far the face may move from its neutral before it eases off (a yawn, a hand over the
                         # mouth, a bad frame can't tear the painting)
EYES = [11, 13, 15, 16, 18]       # LivePortrait's implicit keypoints that carry the eyes (its retargeting uses these)
LIPS = [6, 12, 14, 17, 19, 20]    # ...and the mouth
EYE_SMOOTH = 0.05        # a blink lasts 3-4 frames: the eyes are barely smoothed, or it never shows
LIP_SMOOTH = 0.15        # the mouth: a little (talking, a smile coming)
FEATURE_ROOM = 1.8       # the eyes and the mouth may move this much further than the rest before easing off (a full
                         # smile, eyes shut)
DRIFT = 0.003            # per frame, the neutral drifts toward the player's resting face (a neutral caught mid-word,
                         # or a player standing at an angle, doesn't bend the portrait for the rest of the life)


class Steady:
    """Between the tracker and the warp: what keeps the portrait from distorting. Takes each frame's raw pose
    (pitch, yaw, roll in degrees; t, scale, exp as tensors) and returns the pose to draw, or None to keep the last
    frame. Works on anything with abs()/max()/tanh() (torch tensors in the animator, the tests use them too)."""
    ANG = ("pitch", "yaw", "roll")

    def __init__(self, tanh):
        self.tanh = tanh
        self.reset()

    def reset(self):
        self.ref = None          # the neutral: {"exp", "t", "scale", "ang": {pitch, yaw, roll}}
        self.prev = None         # the last pose accepted (smoothed)
        self.raw = None          # the last raw pose seen
        self.held = 0            # frames held in a row
        self.stat = {"held": 0, "eased": 0}

    @staticmethod
    def _per(t, rest, eyes, lips):
        """A per-keypoint value shaped like t[..., :1]: `rest` everywhere, `eyes` on the eyes, `lips` on the mouth."""
        w = t[..., :1] * 0 + rest
        w[:, EYES] = eyes
        w[:, LIPS] = lips
        return w

    def _calm(self, t):
        """1 on the face's slow parts, 0 on the eyes and the mouth (for the glitch test)."""
        return self._per(t, 1.0, 0.0, 0.0)

    def step(self, raw, opts):
        """raw: {pitch, yaw, roll, t, scale, exp}. -> {"ang": {...}, "exp": change since neutral (eased), "pose": smoothed}
        or None (hold the last frame: the tracker slipped)."""
        f = lambda v: float(v.max()) if hasattr(v, "max") else float(v)
        if self.raw is not None and self.held < HOLD_MAX:
            jump = max(abs(f(raw[k] - self.raw[k])) for k in self.ANG)
            jexp = f(((raw["exp"] - self.raw["exp"]) * self._calm(raw["exp"])).abs())   # (blinks and the mouth are fast: not glitches)
            if jump > JUMP_DEG or jexp > JUMP_EXP:
                self.held += 1; self.stat["held"] += 1
                return None
        self.held = 0
        self.raw = raw
        a = max(0.0, min(0.9, float(opts.get("smooth", 0.3))))
        b = max(0.0, min(0.9, float(opts.get("face_smooth", 0.3))))
        pose = dict(raw)
        if self.prev is not None:
            pose = {k: self.prev[k] * a + v * (1 - a) for k, v in raw.items() if k != "exp"}
            wb = self._per(raw["exp"], b, min(b, EYE_SMOOTH), min(b, LIP_SMOOTH))   # the face: the eyes and mouth quicker
            pose["exp"] = self.prev["exp"] * wb + raw["exp"] * (1 - wb)
        self.prev = pose
        if self.ref is None:
            self.ref = {"exp": pose["exp"], "t": pose["t"], "scale": pose["scale"], "ang": {k: pose[k] for k in self.ANG}}
        else:                                                   # the neutral follows the resting face, slowly
            r = self.ref
            r["exp"] = r["exp"] * (1 - DRIFT) + pose["exp"] * DRIFT
            r["ang"] = {k: r["ang"][k] * (1 - DRIFT) + pose[k] * DRIFT for k in self.ANG}
        lim = max(5.0, float(opts.get("turn_limit", 22)))
        ang = {}
        for k, fac in (("yaw", 1.0), ("pitch", 0.7), ("roll", 0.7)):          # soft limit on the turn since neutral
            L = lim * fac
            ang[k] = self.ref["ang"][k] + L * self.tanh((pose[k] - self.ref["ang"][k]) / L)
        d = pose["exp"] - self.ref["exp"]
        L0 = float(opts.get("face_limit", EXP_LIMIT))
        L = self._per(d, L0, L0 * FEATURE_ROOM, L0 * FEATURE_ROOM)
        eased = L * self.tanh(d / L)                            # soft: small changes pass, big ones ease off
        if f((d - eased).abs()) > L0 * 0.1:
            self.stat["eased"] += 1
        return {"ang": ang, "exp": eased, "pose": pose}


def ort_preload():
    """onnxruntime-gpu needs CUDA 12's cuBLAS and cuDNN; torch may bring a different CUDA. Load the ones from the
    nvidia-* pip packages (pip install "onnxruntime-gpu[cuda,cudnn]") before any session, so detection is on the GPU."""
    try:
        import onnxruntime as ort
        if hasattr(ort, "preload_dlls"):
            ort.preload_dlls()
    except Exception as e:
        print(f"[onnx] couldn't preload the CUDA libraries: {e}")


def ort_where(sessions):
    """'GPU' only if every session really runs on CUDA (onnxruntime falls back to the CPU quietly)."""
    try:
        provs = [s.get_providers()[0] for s in sessions if s is not None]
        return "GPU" if provs and all(p == "CUDAExecutionProvider" for p in provs) else "CPU"
    except Exception:
        return "?"


ORT_FIX = 'pip install -q "onnxruntime-gpu[cuda,cudnn]"  (then restart the server)'


def _head_info(lmk, w, h, yaw=0.0, pitch=0.0, roll=0.0):
    lo, hi = lmk.min(0), lmk.max(0)
    c = (lo + hi) / 2
    return {"x": round(float(c[0] / w), 3), "y": round(float(c[1] / h), 3), "size": round(float((hi[0] - lo[0]) / w), 3),
            "yaw": round(float(yaw), 1), "pitch": round(float(pitch), 1), "roll": round(float(roll), 1)}


class Animator:
    def __init__(self, lp_dir=LP_DIR):
        if not os.path.isdir(os.path.join(lp_dir, "src")):
            raise RuntimeError(f"LivePortrait isn't at {lp_dir} (run setup_liveportrait.sh)")
        if not os.path.isdir(os.path.join(lp_dir, "pretrained_weights", "liveportrait")):
            raise RuntimeError(f"LivePortrait's weights aren't in {lp_dir}/pretrained_weights (run setup_liveportrait.sh)")
        if lp_dir not in sys.path:
            sys.path.insert(0, lp_dir)
        ort_preload()
        import cv2
        import torch
        from src.config.crop_config import CropConfig
        from src.config.inference_config import InferenceConfig
        from src.live_portrait_wrapper import LivePortraitWrapper
        from src.utils.camera import get_rotation_matrix
        from src.utils.crop import crop_image, paste_back, prepare_paste_back
        from src.utils.cropper import Cropper
        from src.utils.io import resize_to_limit

        self.cv2, self.torch = cv2, torch
        self.rot, self.crop_image, self.paste_back, self.prepare_paste_back = get_rotation_matrix, crop_image, paste_back, prepare_paste_back
        self.resize_to_limit = resize_to_limit
        self.cfg, self.crop_cfg = InferenceConfig(), CropConfig()
        if os.environ.get("LP_FORCE_CPU") == "1":                 # testing without a GPU (slow)
            self.cfg.flag_force_cpu, self.cfg.flag_use_half_precision, self.crop_cfg.flag_force_cpu = True, False, True
        self.w = LivePortraitWrapper(inference_cfg=self.cfg)
        self.cropper = Cropper(crop_cfg=self.crop_cfg)
        fa = self.cropper.face_analysis_wrapper
        sessions = [getattr(self.cropper.human_landmark_runner, "session", None)] + \
                   [getattr(m, "session", None) for m in getattr(fa, "models", {}).values()]
        self.where = ort_where(sessions)
        print(f"[animate] face detection on the {self.where}" + ("" if self.where == "GPU" else f" (slow, uneven). Fix: {ORT_FIX}"), flush=True)
        self.lock = threading.Lock()
        # multiplier: how much of your motion; smooth: steadies the HEAD only (eyes and mouth stay raw);
        # follow: how much the portrait follows where your head is (left/right, nearer/further), 0 = turning only
        # turn_limit: degrees of turn (left/right) the portrait follows fully; tilts and nods get 70 % of it.
        # Beyond that it eases off instead of bending the painting (LivePortrait smears past ~20 degrees of tilt)
        # face_smooth: steadies eyes and mouth (0 = raw: crisp but the tracker's noise shows)
        self.opts = {"multiplier": 1.0, "smooth": 0.3, "face_smooth": 0.3, "follow": 0.0, "turn_limit": 22, "redetect": 10, "quality": 85,
                     "face_limit": EXP_LIMIT}
        self.steady = Steady(torch.tanh)
        self.src = None
        self.next = None         # a second portrait, moved by the same motion: the game dissolves one age into the next
        self.last_head = None
        self.reset()

    # ---- the portrait ----
    def set_source(self, rgb, slot="main"):
        """slot "main": the portrait to move. slot "next": the one coming in, moved alongside it (same motion) until
        promote() makes it the portrait, or drop_next() lets it go."""
        w, cfg = self.w, self.cfg
        with self.lock, self.torch.no_grad():
            img = self.resize_to_limit(np.ascontiguousarray(rgb), 1280, 2)
            info = self.cropper.crop_source_image(img, self.crop_cfg)
            if info is None:
                return False
            I_s = w.prepare_source(info["img_crop_256x256"])
            x_s_info = w.get_kp_info(I_s)
            x_s = w.transform_keypoint(x_s_info)
            lip = None
            if cfg.flag_normalize_lip and info.get("lmk_crop") is not None:      # start with the mouth closed
                r = w.calc_combined_lip_ratio([0.0], info["lmk_crop"])
                if r[0][0] >= cfg.lip_normalize_threshold:
                    lip = w.retarget_lip(x_s, r)
            src = {
                "img": img, "M_c2o": info["M_c2o"], "x_s_info": x_s_info, "x_c_s": x_s_info["kp"], "x_s": x_s,
                "R_s": self.rot(x_s_info["pitch"], x_s_info["yaw"], x_s_info["roll"]),
                "f_s": w.extract_feature_3d(I_s), "lip": lip,
                "mask": self.prepare_paste_back(cfg.mask_crop, info["M_c2o"], dsize=(img.shape[1], img.shape[0])),
            }
            if slot == "next" and self.src is not None:
                self.next = src                                       # (the driver's neutral and smoothing carry on)
            else:
                self.src, self.next = src, None
                self.last_imgs = None
        return True

    def promote(self):
        """The incoming portrait becomes the portrait (the age change is done). The motion carries on unbroken."""
        with self.lock:
            if self.next is not None:
                self.src, self.next = self.next, None

    def drop_next(self):
        with self.lock:
            self.next = None

    def reset(self):
        self.ref = None          # the neutral face: (kp info, rotation) of the first face seen after this
        self.prev = None         # the head's last pose (angles, position, size), for smoothing
        self.ref_lmk = None      # where the face was at neutral: frames are cropped there, so moving your head shows
        self.lmk = None          # tracked landmarks
        self.n = 0
        self.missing = 0
        self.last_imgs = None    # the last frame drawn (held while the tracker slips)
        if hasattr(self, "steady"):
            self.steady.reset()

    # ---- a head-and-shoulders square around the face in a photo (for painting portraits from the player) ----
    def face_box(self, rgb):
        with self.lock:
            faces = self.cropper.face_analysis_wrapper.get(np.ascontiguousarray(rgb[..., ::-1]), flag_do_landmark_2d_106=False,
                                                           direction="large-small")
        if not faces:
            return None
        x1, y1, x2, y2 = [float(v) for v in faces[0].bbox[:4]]
        return x1, y1, x2, y2

    # ---- detection: find and follow the face in the camera frame ----
    def track(self, rgb):
        self.n += 1
        lmk = self.lmk
        if lmk is None or self.n % max(1, int(self.opts["redetect"])) == 0:
            faces = self.cropper.face_analysis_wrapper.get(np.ascontiguousarray(rgb[..., ::-1]), flag_do_landmark_2d_106=True,
                                                           direction="large-small")
            if not faces:
                self.lmk = None
                return None
            lmk = faces[0].landmark_2d_106
        lmk = self.cropper.human_landmark_runner.run(rgb, lmk)
        span = lmk.max(0) - lmk.min(0)
        cx, cy = lmk.mean(0)
        if span.min() < 12 or span[0] < MIN_FACE * rgb.shape[1] or not (0 <= cx < rgb.shape[1] and 0 <= cy < rgb.shape[0]):
            self.lmk = None
            return None
        self.lmk = lmk
        return lmk

    # ---- one frame ----
    def drive(self, rgb):
        t = {"track": 0.0, "motion": 0.0, "warp": 0.0, "paste": 0.0}
        s, w, torch = self.src, self.w, self.torch
        t0 = time.perf_counter()
        lmk = self.track(rgb)
        t1 = time.perf_counter()
        t["track"] = (t1 - t0) * 1000
        if lmk is None:
            self.missing += 1
            if self.missing > LOST_AFTER:                             # they left: the next face is a new neutral
                self.steady.reset(); self.ref_lmk = None; self.last_imgs = None
            self.last_head = None
            if self.last_imgs is not None and len(self.last_imgs) == len([x for x in (s, self.next) if x is not None]):
                return self.last_imgs, {"face": False, "ms": t, "held": True}   # a blink of a lost face: no jump back
            return [x["img"] for x in (s, self.next) if x is not None], {"face": False, "ms": t}
        self.missing = 0
        follow = max(0.0, min(1.0, float(self.opts.get("follow", 0.0))))
        if follow > 0 and self.ref_lmk is not None:                   # follow mode only: moved out of the neutral
            c0, c1 = self.ref_lmk.mean(0), lmk.mean(0)                 # window -> start a new neutral there
            size = float((self.ref_lmk.max(0) - self.ref_lmk.min(0)).max())
            if float(np.abs(c1 - c0).max()) > size * 0.9:
                self.steady.reset(); self.ref_lmk = None
        with torch.no_grad():
            # crop where the face was at neutral (so moving your head moves you in the crop) unless follow is off
            box = self.ref_lmk if (self.ref_lmk is not None and follow > 0) else lmk
            crop = self.crop_image(rgb, box, dsize=256, scale=2.2, vy_ratio=-0.1, flag_do_rot=False)
            I_d = w.prepare_source(crop["img_crop"])
            x_d = w.get_kp_info(I_d)
            raw = {k: x_d[k] for k in ("pitch", "yaw", "roll", "t", "scale", "exp")}
            st = self.steady.step(raw, self.opts)                     # steadied: glitches held, big faces eased
            t2 = time.perf_counter()
            t["motion"] = (t2 - t1) * 1000
            if st is None and self.last_imgs is not None:              # the tracker slipped: keep the last frame
                return self.last_imgs, {"face": True, "head": self.last_head, "ms": t, "held": True, "steady": dict(self.steady.stat)}
            if st is None:                                            # (nothing drawn yet to hold: take this one)
                self.steady.held = HOLD_MAX
                st = self.steady.step(raw, self.opts)
            if self.ref_lmk is None:
                self.ref_lmk = lmk.copy()
            R_d = self.rot(st["ang"]["pitch"], st["ang"]["yaw"], st["ang"]["roll"])
            ref = self.steady.ref
            R0 = self.rot(ref["ang"]["pitch"], ref["ang"]["yaw"], ref["ang"]["roll"])
            faces = [(src, self.move(src, R_d, R0, ref, st, follow)) for src in (s, self.next) if src is not None]
            t3 = time.perf_counter()
            t["warp"] = (t3 - t2) * 1000
        imgs = [self.paste_back(face, src["M_c2o"], src["img"], src["mask"]) for src, face in faces]
        self.last_imgs = imgs
        t["paste"] = (time.perf_counter() - t3) * 1000
        head = _head_info(lmk, rgb.shape[1], rgb.shape[0], x_d["yaw"].item(), x_d["pitch"].item(), x_d["roll"].item())
        self.last_head, self.head_at = head, time.time()
        return imgs, {"face": True, "head": head, "ms": t, "steady": dict(self.steady.stat)}

    def move(self, s, R_d, R0, x0, st, follow):
        """Your change since neutral (steadied), applied to one portrait's own pose and face -> its face, warped."""
        w = self.w
        xs, pose = s["x_s_info"], st["pose"]
        R_new = (R_d @ R0.permute(0, 2, 1)) @ s["R_s"]
        delta = xs["exp"] + st["exp"]
        scale = xs["scale"] * (1 + (pose["scale"] / x0["scale"] - 1) * follow)
        t_new = xs["t"] + (pose["t"] - x0["t"]) * follow
        t_new[..., 2].fill_(0)
        x_new = scale * (s["x_c_s"] @ R_new + delta) + t_new
        x_new = w.stitching(s["x_s"], x_new)
        if s["lip"] is not None:
            x_new = x_new + s["lip"]
        x_new = s["x_s"] + (x_new - s["x_s"]) * float(self.opts["multiplier"])
        out = w.warp_decode(s["f_s"], s["x_s"], x_new)
        return w.parse_output(out["out"])[0]

    def drive_jpeg(self, jpeg):
        cv2 = self.cv2
        t0 = time.perf_counter()
        bgr = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        if bgr is None:
            return b"", {"note": "couldn't read the camera frame"}
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        t1 = time.perf_counter()
        with self.lock:
            if self.src is None:
                return b"", {"note": "no portrait yet"}
            imgs, info = self.drive(rgb)
        t2 = time.perf_counter()
        out = []
        for img in imgs:
            ok, buf = cv2.imencode(".jpg", cv2.cvtColor(img, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, int(self.opts["quality"])])
            out.append(buf.tobytes() if ok else b"")
        t3 = time.perf_counter()
        info["ms"]["jpeg"] = ((t1 - t0) + (t3 - t2)) * 1000
        info["ms"]["total"] = (t3 - t0) * 1000
        return pack_jpegs(out, info)


def pack_jpegs(out, info):
    """One jpeg: as it always was. Two (an age change): info["jpeg"] = the first one's length, info["next"] = the second's;
    the bytes are the two one after the other."""
    if len(out) > 1:
        info["jpeg"], info["next"] = len(out[0]), len(out[1])
    return b"".join(out), info


class MockAnimator:
    """No model: the portrait tilts and drifts gently, so the test page and the WebSocket can be tried on the Mac."""

    def __init__(self):
        self.lock = threading.Lock()
        self.opts = {"multiplier": 1.0, "smooth": 0.3, "redetect": 10, "quality": 85}
        self.src = None
        self.next = None
        self.last_head = None
        self.t0 = time.time()

    def set_source(self, rgb, slot="main"):
        from PIL import Image
        with self.lock:
            img = Image.fromarray(np.ascontiguousarray(rgb))
            if slot == "next" and self.src is not None:
                self.next = img
            else:
                self.src, self.next = img, None
        return True

    def promote(self):
        with self.lock:
            if self.next is not None:
                self.src, self.next = self.next, None

    def drop_next(self):
        with self.lock:
            self.next = None

    def reset(self):
        self.t0 = time.time()

    def drive_jpeg(self, jpeg):
        from PIL import Image
        t0 = time.perf_counter()
        try:
            Image.open(io.BytesIO(jpeg)).load()
        except Exception:
            return b"", {"note": "couldn't read the camera frame"}
        with self.lock:
            if self.src is None:
                return b"", {"note": "no portrait yet"}
            time.sleep(0.02)                                          # pretend to work
            k = time.time() - self.t0
            m = float(self.opts["multiplier"])
            yaw, roll = 12 * m * np.sin(k * 0.9), 4 * m * np.sin(k * 0.6)
            out = []
            for src in (self.src, self.next):
                if src is None:
                    continue
                img = src.rotate(roll, resample=Image.BICUBIC, translate=(yaw * 0.6, 0), fillcolor=(235, 225, 215))
                buf = io.BytesIO()
                img.save(buf, "JPEG", quality=int(self.opts["quality"]))
                out.append(buf.getvalue())
        ms = (time.perf_counter() - t0) * 1000
        head = {"x": round(0.5 + yaw / 100, 3), "y": 0.45, "size": 0.25, "yaw": round(yaw, 1), "pitch": 0.0, "roll": round(roll, 1)}
        self.last_head = head
        self.head_at = time.time()
        return pack_jpegs(out, {"face": True, "head": head, "mock": True,
                                "ms": {"track": 0.0, "motion": 0.0, "warp": ms, "paste": 0.0, "jpeg": 0.0, "total": ms}})
