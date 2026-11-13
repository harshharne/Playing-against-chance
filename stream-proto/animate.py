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
        self.lock = threading.Lock()
        self.opts = {"multiplier": 1.0, "smooth": 0.3, "redetect": 10, "quality": 85}
        self.src = None
        self.last_head = None
        self.reset()

    # ---- the portrait ----
    def set_source(self, rgb):
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
            self.src = {
                "img": img, "M_c2o": info["M_c2o"], "x_s_info": x_s_info, "x_c_s": x_s_info["kp"], "x_s": x_s,
                "R_s": self.rot(x_s_info["pitch"], x_s_info["yaw"], x_s_info["roll"]),
                "f_s": w.extract_feature_3d(I_s), "lip": lip,
                "mask": self.prepare_paste_back(cfg.mask_crop, info["M_c2o"], dsize=(img.shape[1], img.shape[0])),
            }
            self.prev = None
        return True

    def reset(self):
        self.ref = None          # the neutral face: (kp info, rotation) of the first face seen after this
        self.prev = None         # last driving keypoints, for smoothing
        self.lmk = None          # tracked landmarks
        self.n = 0
        self.missing = 0

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
        if span.min() < 12 or not (0 <= cx < rgb.shape[1] and 0 <= cy < rgb.shape[0]):
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
            if self.missing > LOST_AFTER:
                self.ref, self.prev = None, None                     # they left: the next face is a new neutral
            self.last_head = None
            return s["img"], {"face": False, "ms": t}
        self.missing = 0
        with torch.no_grad():
            crop = self.crop_image(rgb, lmk, dsize=256, scale=2.2, vy_ratio=-0.1, flag_do_rot=False)
            I_d = w.prepare_source(crop["img_crop"])
            x_d = w.get_kp_info(I_d)
            R_d = self.rot(x_d["pitch"], x_d["yaw"], x_d["roll"])
            if self.ref is None:
                self.ref = (x_d, R_d)
            x0, R0 = self.ref
            xs = s["x_s_info"]
            R_new = (R_d @ R0.permute(0, 2, 1)) @ s["R_s"]                     # relative motion: your change since neutral,
            delta = xs["exp"] + (x_d["exp"] - x0["exp"])                       # applied to the portrait's own pose and face
            scale = xs["scale"] * (x_d["scale"] / x0["scale"])
            t_new = xs["t"] + (x_d["t"] - x0["t"])
            t_new[..., 2].fill_(0)
            x_new = scale * (s["x_c_s"] @ R_new + delta) + t_new
            x_new = w.stitching(s["x_s"], x_new)
            if s["lip"] is not None:
                x_new = x_new + s["lip"]
            x_new = s["x_s"] + (x_new - s["x_s"]) * float(self.opts["multiplier"])
            a = max(0.0, min(0.95, float(self.opts["smooth"])))
            if self.prev is not None and a > 0:
                x_new = self.prev * a + x_new * (1 - a)
            self.prev = x_new
            t2 = time.perf_counter()
            t["motion"] = (t2 - t1) * 1000
            out = w.warp_decode(s["f_s"], s["x_s"], x_new)
            face = w.parse_output(out["out"])[0]
            t3 = time.perf_counter()
            t["warp"] = (t3 - t2) * 1000
        img = self.paste_back(face, s["M_c2o"], s["img"], s["mask"])
        t["paste"] = (time.perf_counter() - t3) * 1000
        head = _head_info(lmk, rgb.shape[1], rgb.shape[0], x_d["yaw"].item(), x_d["pitch"].item(), x_d["roll"].item())
        self.last_head = head
        return img, {"face": True, "head": head, "ms": t}

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
            img, info = self.drive(rgb)
        t2 = time.perf_counter()
        ok, buf = cv2.imencode(".jpg", cv2.cvtColor(img, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, int(self.opts["quality"])])
        t3 = time.perf_counter()
        info["ms"]["jpeg"] = ((t1 - t0) + (t3 - t2)) * 1000
        info["ms"]["total"] = (t3 - t0) * 1000
        return buf.tobytes() if ok else b"", info


class MockAnimator:
    """No model: the portrait tilts and drifts gently, so the test page and the WebSocket can be tried on the Mac."""

    def __init__(self):
        self.lock = threading.Lock()
        self.opts = {"multiplier": 1.0, "smooth": 0.3, "redetect": 10, "quality": 85}
        self.src = None
        self.last_head = None
        self.t0 = time.time()

    def set_source(self, rgb):
        from PIL import Image
        with self.lock:
            self.src = Image.fromarray(np.ascontiguousarray(rgb))
        return True

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
            img = self.src.rotate(roll, resample=Image.BICUBIC, translate=(yaw * 0.6, 0), fillcolor=(235, 225, 215))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=int(self.opts["quality"]))
        ms = (time.perf_counter() - t0) * 1000
        head = {"x": round(0.5 + yaw / 100, 3), "y": 0.45, "size": 0.25, "yaw": round(yaw, 1), "pitch": 0.0, "roll": round(roll, 1)}
        self.last_head = head
        return buf.getvalue(), {"face": True, "head": head, "mock": True,
                                "ms": {"track": 0.0, "motion": 0.0, "warp": ms, "paste": 0.0, "jpeg": 0.0, "total": ms}}
