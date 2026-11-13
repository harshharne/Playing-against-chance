"""
Live webcam -> diffusion. Runs on the cloud GPU (chance-rtx, RTX PRO 6000; first built on an L4); also works on a Mac (MPS), slowly.

Two separate generations:
  WORLD (background)  made once per draw from its own prompt (a few steps, full-quality VAE).
  AVATAR (person)     the browser cuts the person out of the camera and sends the frame here; it is
                      encoded with the tiny VAE, noised by CHANGE, repainted in ONE step and sent back.
Both use the same painter and the same style LoRAs, so they share one look.

THE PAINTER (set PAINTER=... when starting)
  dmd   (default) DreamShaper 8 distilled to ONE step with DMD (aaronb/dreamshaper-8-dmd-1kstep, from OpenDMD).
        It paints from pure noise in one step and has guidance baked in (no CFG needed).
  lcm   the previous painter: DreamShaper 8 + LCM-LoRA. Kept to compare against.

STRUCTURE (stage 2): ControlNet holds the body while the painter repaints everything else.
  depth   Depth Anything V2 small reads a depth map of each frame here, on the GPU -> depth ControlNet.
  pose    the browser finds the joints (MediaPipe Pose) and sends them with the frame; they're drawn here in
          OpenPose's format (colours, limbs) -> OpenPose ControlNet.
  The shape the painter follows can be seen on /panel (GET /shape).

STYLE
  loras/        any SD 1.5 LoRA (.safetensors) dropped in here shows up on /panel. Two slots, each with a weight.
                A .txt file with the same name holds its trigger words, added to the prompt while it's on.
                Three are downloaded on first start (pixel art, sketch, watercolor).
  IP-Adapter    STYLE / IMAGE reference images from the lab page (style-only mode comes in stage 3).
  style prompt, negative prompt, guidance   on /panel.

All tuning lives HERE (one set of values for the game and the lab), changed live from /panel, saved as
presets in presets/.   GET/POST /settings,  GET /presets,  POST /presets?name=,  GET /presets/<name>

First time:     python download_models.py   (downloads everything once)
Run:            python stream_server.py      then open http://localhost:8766  (/game, /panel)
Without model:  MOCK=1 python stream_server.py  (fake effect, to test the pages)
"""

import asyncio
import collections
import io
import json
import os
import random
import re
import secrets
import shutil
import time
import urllib.request
import zlib

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageDraw, ImageFilter, ImageOps, ImageStat

# ---------- settings you may want to tweak ----------
PORT = 8766
WIDTH, HEIGHT = 640, 384          # avatar size (set per painter below); both must be multiples of 64
SEED = 7                          # noise used for the live person frames
PAINTER = os.environ.get("PAINTER", "dmd")
MOCK = os.environ.get("MOCK") == "1"
DWPOSE_MODE = os.environ.get("DWPOSE_MODE", "lightweight")   # rtmlib whole-body detector: lightweight | balanced | performance


def set_sizes(painter):
    """Avatar, world and baby-portrait sizes. SDXL looks poor much below ~768 px, so it paints bigger."""
    global WIDTH, HEIGHT, WORLD_W, WORLD_H, PORTRAIT
    if painter == "sdxl":
        WIDTH, HEIGHT, WORLD_W, WORLD_H, PORTRAIT = 768, 448, 1344, 768, 768
    else:
        WIDTH, HEIGHT, WORLD_W, WORLD_H, PORTRAIT = 640, 384, 640, 384, 512


set_sizes(PAINTER)

BASE_MODEL = "Lykon/dreamshaper-8"                          # text encoder, VAE, image encoder come from here
DMD_UNET = "aaronb/dreamshaper-8-dmd-1kstep"                # the one-step painter (only the UNet changes)
LCM_LORA = "latent-consistency/lcm-lora-sdv1-5"
IP_ADAPTER = ("h94/IP-Adapter", "models", "ip-adapter-plus_sd15.safetensors")
TINY_VAE = "madebyollin/taesd"
CONTROLNETS = {"depth": "lllyasviel/control_v11f1p_sd15_depth", "pose": "lllyasviel/control_v11p_sd15_openpose"}
DEPTH_MODEL = "depth-anything/Depth-Anything-V2-Small-hf"
# SDXL (PAINTER=sdxl): a one-step painter for the live avatar, a 4-step one for the worlds and the baby
SDXL_LIVE = "stabilityai/sdxl-turbo"                         # 1 step, made for img2img at partial strength (non-commercial licence)
SDXL_WORLD = "Lykon/dreamshaper-xl-lightning"                # 4 steps, CFG 2, painterly (openrail++)
SDXL_VAE = "madebyollin/sdxl-vae-fp16-fix"
SDXL_TINY = "madebyollin/taesdxl"
SDXL_CONTROLNETS = {"depth": "diffusers/controlnet-depth-sdxl-1.0-small", "pose": "xinsir/controlnet-openpose-sdxl-1.0"}
SDXL_IP = ("h94/IP-Adapter", "sdxl_models", "ip-adapter-plus_sdxl_vit-h.safetensors", "models/image_encoder")
SDXL_WORLD_STEPS, SDXL_WORLD_CFG = 4, 2.0
BG_IMAGE_KEEP = 0.35              # background IMAGE reference: how much of the picture survives (0.2–0.6)

HERE = os.path.dirname(os.path.abspath(__file__))
LORA_DIR = os.path.join(HERE, "loras")
PRESET_DIR = os.path.join(HERE, "presets")
TRAJECTORY_FILE = os.path.join(HERE, "trajectory.json")   # the life: events, cards, bridge lines, timings (edit freely)
STYLES_FILE = os.path.join(HERE, "styles.json")      # the looks on /panel (cartoon, caricature, pixel art, ...): edit freely

# style LoRAs fetched on first start (all SD 1.5, none anime). file in loras/ <- (repo, file in repo or None = find it), trigger words
DEFAULT_LORAS = {
    "pixel-art.safetensors": ("artificialguybr/pixelartredmond-1-5v-pixel-art-loras-for-sd-1-5",
                              "PixelArtRedmond15V-PixelArt-PIXARFK.safetensors", "Pixel Art, PixArFK"),
    "sketch.safetensors": ("jordanhilado/sd-1-5-sketch-lora", None, ""),
    "watercolor.safetensors": ("fladdict/watercolor", "fladdict-watercolor-sd-1-5.safetensors", "watercolor painting"),
}

# chance: random.org (true randomness). Falls back to the computer's own randomness if it can't be reached.
def _read_key_file():
    """the key lives in random_org.key next to this file (kept out of git), or in the RANDOM_ORG_KEY variable"""
    try:
        with open(os.path.join(HERE, "random_org.key")) as f:
            return f.read().strip()
    except OSError:
        return ""


RANDOM_ORG_KEY = os.environ.get("RANDOM_ORG_KEY") or _read_key_file()
if not RANDOM_ORG_KEY:
    print("[chance] no random.org key (random_org.key or RANDOM_ORG_KEY): using local randomness")

# ---------- the tuning (changed live from /panel) ----------
TUNE_DEFAULTS = {
    # structure
    "shape": "depth",         # what holds the body: "depth", "pose", "both" (depth + pose) or "off"
    "cn_strength": 0.8,       # how strongly ControlNet holds it
    "child_until": 12.0,      # below this age: no depth (an adult's depth makes adult proportions); the pose is reshaped to a child's
    "child_cn": 0.45,         # how hard the youngest avatar is held (x ControlNet strength), rising to 1 at CHILD UNTIL
    # change
    "change": 0.6,            # how much the avatar is repainted (1.0 = from pure noise: the painter's home ground)
    "world_steps": 2,         # world: painting steps (1 = what DMD is trained for; more = more detail, maybe worse)
    # style
    "style": "painterly",     # a look from styles.json: words added to every prompt + a browser filter (stage one: paint only)
    "lora_a": "", "lora_a_w": 0.8,
    "lora_b": "", "lora_b_w": 0.5,
    "ip_style": 0.6,          # how strongly STYLE / IMAGE references steer the look
    "ref_mode": "style",      # where references act: "style" (look only, InstantStyle), "layout" (look + composition), "all" (look + content)
    "style_prompt": "",       # added to every prompt (avatar and world)
    "negative": "photo, realistic, blurry, deformed, extra limbs",
    "guidance": 1.0,          # 1.0 = off (DMD's own). Above 1: the negative prompt works, each frame costs ~2x
    # stability
    "steady": 0.4,            # how much each frame leans on the last one (when you're still)
    "ghost_guard": 0.5,       # how quickly that leaning lets go when you move (0 = never: smooth but ghosty, 1 = at once)
    "skip_still": 1.5,        # browser: don't send a new frame unless the camera changed at least this much (0 = always send)
    "parallax": 0.03,         # browser: how far the world shifts with your head (0 = flat)
}
TUNE = dict(TUNE_DEFAULTS)
LOOK_KEYS = {"style", "ref_mode", "world_steps", "lora_a", "lora_a_w", "lora_b", "lora_b_w", "ip_style", "style_prompt", "negative", "guidance"}
look_version = 0              # goes up when the look changes, so the pages redraw the world
pace_version = 0              # goes up when a timing in trajectory.json is changed from /panel
tune_version = 0              # goes up on any change, so the pages send a fresh avatar frame

app = FastAPI()


# ---------- looks (styles.json) ----------
_styles = {"mtime": None, "data": {}}


def load_styles():
    """styles.json, re-read whenever it changes on disk (so edits show up without a restart)."""
    try:
        m = os.path.getmtime(STYLES_FILE)
        if m != _styles["mtime"]:
            with open(STYLES_FILE) as fh:
                data = json.load(fh)
            _styles["data"] = {k: v for k, v in data.items() if not k.startswith("_") and isinstance(v, dict)}
            _styles["mtime"] = m
    except (OSError, ValueError) as e:
        print("[style] couldn't read styles.json:", e)
    return _styles["data"]


def current_style():
    return load_styles().get(TUNE["style"], {})


# ---------- LoRA files ----------
def list_loras():
    os.makedirs(LORA_DIR, exist_ok=True)
    return sorted(f for f in os.listdir(LORA_DIR) if f.endswith((".safetensors", ".bin")))


def trigger_words(file):
    p = os.path.join(LORA_DIR, os.path.splitext(file)[0] + ".txt")
    try:
        with open(p) as fh:
            return fh.read().strip()
    except OSError:
        return ""


def download_loras():
    """Fetch the default style LoRAs into loras/ (skips the ones already there)."""
    from huggingface_hub import hf_hub_download, list_repo_files
    os.makedirs(LORA_DIR, exist_ok=True)
    for file, (repo, name, trigger) in DEFAULT_LORAS.items():
        dest = os.path.join(LORA_DIR, file)
        if trigger and not os.path.exists(dest[:-len(".safetensors")] + ".txt"):
            with open(dest[:-len(".safetensors")] + ".txt", "w") as fh:
                fh.write(trigger)
        if os.path.exists(dest) or os.path.exists(dest[:-len(".safetensors")] + ".bin"):
            continue
        try:
            if name is None:                                     # find the weights file in the repo
                files = list_repo_files(repo)
                cands = [f for f in files if f.endswith(".safetensors")] or [f for f in files if f.endswith(".bin")]
                name = cands[0]
                if name.endswith(".bin"):
                    dest = dest[:-len(".safetensors")] + ".bin"
            shutil.copy(hf_hub_download(repo, name), dest)
            print(f"[lora] downloaded {file}  ({repo})")
        except Exception as e:
            print(f"[lora] couldn't download {file} from {repo}: {e}")


# ---------- OpenPose-format skeleton, from MediaPipe Pose's 33 points ----------
# OpenPose's 18 joints: nose, neck, r-shoulder, r-elbow, r-wrist, l-shoulder, l-elbow, l-wrist, r-hip, r-knee, r-ankle,
# l-hip, l-knee, l-ankle, r-eye, l-eye, r-ear, l-ear. "neck" is the middle of the shoulders.
OP_FROM_MP = [0, None, 12, 14, 16, 11, 13, 15, 24, 26, 28, 23, 25, 27, 5, 2, 8, 7]
OP_LIMBS = [(1, 2), (1, 5), (2, 3), (3, 4), (5, 6), (6, 7), (1, 8), (8, 9), (9, 10), (1, 11), (11, 12), (12, 13),
            (1, 0), (0, 14), (14, 16), (0, 15), (15, 17)]
OP_COLOURS = [(255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0), (170, 255, 0), (85, 255, 0), (0, 255, 0),
              (0, 255, 85), (0, 255, 170), (0, 255, 255), (0, 170, 255), (0, 85, 255), (0, 0, 255), (85, 0, 255),
              (170, 0, 255), (255, 0, 255), (255, 0, 170), (255, 0, 85)]


def child_scale(age):
    """How much smaller than you the avatar's body is drawn at this age (1 = your own proportions)."""
    if age is None or float(TUNE["child_until"]) <= 0 or age >= float(TUNE["child_until"]):
        return 1.0
    return 0.6 + 0.4 * max(0.0, age) / float(TUNE["child_until"])


def reshape_child(kp, neck, nose, head_ids, s):
    """Shrink the body towards the neck by s, keep the head its own size: a child's proportions on your pose."""
    if s >= 0.999 or neck is None:
        return kp
    nn = (neck[0] + (nose[0] - neck[0]) * s, neck[1] + (nose[1] - neck[1]) * s) if nose else None
    out = []
    for i, p in enumerate(kp):
        if p is None:
            out.append(None)
        elif i in head_ids and nose and nn:
            out.append((p[0] + nn[0] - nose[0], p[1] + nn[1] - nose[1]))
        else:
            out.append((neck[0] + (p[0] - neck[0]) * s, neck[1] + (p[1] - neck[1]) * s))
    return out


def draw_openpose(points, w=None, h=None, age=None):
    """points: MediaPipe's 33 [x, y, visibility] (x, y from 0 to 1). Returns the skeleton on black, as OpenPose draws it."""
    w, h = w or WIDTH, h or HEIGHT
    def mp(i):
        if i >= len(points):
            return None
        x, y, v = points[i]
        return (x * w, y * h) if v > 0.5 and -0.05 < x < 1.05 and -0.05 < y < 1.05 else None
    kp = [mp(i) if i is not None else None for i in OP_FROM_MP]
    if kp[2] and kp[5]:
        kp[1] = ((kp[2][0] + kp[5][0]) / 2, (kp[2][1] + kp[5][1]) / 2)
    kp = reshape_child(kp, kp[1], kp[0], {0, 14, 15, 16, 17}, child_scale(age))
    img = Image.new("RGB", (w, h), (0, 0, 0))
    d = ImageDraw.Draw(img)
    stick, r = max(4, round(h * 8 / 512)), max(3, round(h * 4 / 512))
    for i, (a, b) in enumerate(OP_LIMBS):                       # limbs at 60 %, like OpenPose's blend
        if kp[a] and kp[b]:
            d.line([kp[a], kp[b]], fill=tuple(int(c * 0.6) for c in OP_COLOURS[i]), width=stick)
    for i, p in enumerate(kp):
        if p:
            d.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=OP_COLOURS[i])
    return img


# ---------- DWPose: body + hands + face (133 points), on the server (rtmlib, ONNX; on the GPU if onnxruntime-gpu works) ----------
_wb = {"model": None, "tried": False, "error": None, "where": None}


def dwpose():
    if _wb["tried"]:
        return _wb["model"]
    _wb["tried"] = True
    try:
        from rtmlib import Wholebody
        import onnxruntime as ort
        cuda = "CUDAExecutionProvider" in ort.get_available_providers()
        _wb["model"] = Wholebody(to_openpose=True, mode=DWPOSE_MODE, backend="onnxruntime", device="cuda" if cuda else "cpu")
        _wb["where"] = ("GPU" if cuda else "CPU (onnxruntime-gpu not working)") + f", {DWPOSE_MODE}"
        print(f"[pose] DWPose ready on {_wb['where']}")
    except Exception as e:
        _wb["error"] = str(e)[:300]
        print("[pose] DWPose not available, using the browser's MediaPipe joints:", e)
    return _wb["model"]


def dwpose_skeleton(img, age=None):
    """Camera frame (PIL) -> OpenPose-style whole-body skeleton (body, hands, face) on black, or None if DWPose isn't there."""
    wb = dwpose()
    if wb is None:
        return None
    import numpy as np
    import cv2
    from rtmlib import draw_skeleton
    bgr = cv2.cvtColor(np.asarray(img.convert("RGB")), cv2.COLOR_RGB2BGR)
    kps, scores = wb(bgr)
    canvas = np.zeros_like(bgr)
    if len(kps):
        k = int(np.argmax([(p[:, 0].max() - p[:, 0].min()) * (p[:, 1].max() - p[:, 1].min()) for p in kps]))   # the biggest person
        kp, sc = kps[k].copy(), scores[k].copy()
        s = child_scale(age)
        if s < 0.999 and len(kp) >= 134:                             # OpenPose order: 0 nose, 1 neck, 14-17 eyes/ears, 24-91 face
            head = {0, 14, 15, 16, 17, *range(24, 92)}
            pts = reshape_child([tuple(p) for p in kp], tuple(kp[1]), tuple(kp[0]), head, s)
            kp = np.array(pts, dtype=kp.dtype)
        try:
            canvas = draw_skeleton(canvas, kp[None], sc[None], openpose_skeleton=True, kpt_thr=0.4)
        except TypeError:
            canvas = draw_skeleton(canvas, kp[None], sc[None], to_openpose=True, kpt_thr=0.4)
    return Image.fromarray(cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB))


def fetch_structure(dtype=None):
    """Download the ControlNets and the depth reader (for download_models.py)."""
    from diffusers import ControlNetModel
    from transformers import AutoModelForDepthEstimation
    for kind in CONTROLNETS:
        load_controlnet(kind, dtype)
    AutoModelForDepthEstimation.from_pretrained(DEPTH_MODEL)


def load_controlnet(kind, dtype=None):
    from diffusers import ControlNetModel
    try:
        return ControlNetModel.from_pretrained(CONTROLNETS[kind], torch_dtype=dtype, variant="fp16")
    except Exception:
        return ControlNetModel.from_pretrained(CONTROLNETS[kind], torch_dtype=dtype)


def load_pipe(device="cpu", dtype=None):
    """Loads (and on first use downloads) every model the painter needs."""
    import torch
    from diffusers import AutoencoderTiny, LCMScheduler, StableDiffusionPipeline

    dtype = dtype or torch.float16

    def get(repo, **kw):
        try:
            return StableDiffusionPipeline.from_pretrained(repo, torch_dtype=dtype, variant="fp16", safety_checker=None, **kw)
        except Exception:
            return StableDiffusionPipeline.from_pretrained(repo, torch_dtype=dtype, safety_checker=None, **kw)

    if PAINTER == "dmd":
        print(f"[gen] loading the one-step DMD painter ({DMD_UNET}) ...")
        pipe = get(BASE_MODEL, unet=load_dmd_unet(dtype))
    else:
        pipe = get(BASE_MODEL)
        pipe.scheduler = LCMScheduler.from_config(pipe.scheduler.config)
        print("[gen] adding LCM-LoRA (fast steps) ...")
        pipe.load_lora_weights(LCM_LORA, adapter_name="lcm")
        pipe.fuse_lora()
        pipe.unload_lora_weights()                               # keeps the fused weights, frees the slot for style LoRAs
    print("[gen] adding IP-Adapter (reference images) ...")
    pipe.load_ip_adapter(IP_ADAPTER[0], subfolder=IP_ADAPTER[1], weight_name=IP_ADAPTER[2])
    tiny = AutoencoderTiny.from_pretrained(TINY_VAE, torch_dtype=dtype)
    pipe.to(device)
    tiny.to(device)
    pipe.set_progress_bar_config(disable=True)
    return pipe, tiny


def load_dmd_unet(dtype):
    """The DMD repo's layout isn't documented, so try the likely ones in turn."""
    from diffusers import UNet2DConditionModel
    errors = []
    for kw in ({}, {"subfolder": "unet"}):
        try:
            return UNet2DConditionModel.from_pretrained(DMD_UNET, torch_dtype=dtype, **kw)
        except Exception as e:
            errors.append(f"{kw or 'repo root'}: {e}")
    try:                                                         # a single weights file (ComfyUI style)
        from huggingface_hub import hf_hub_download, list_repo_files
        f = next(f for f in list_repo_files(DMD_UNET) if f.endswith(".safetensors"))
        return UNet2DConditionModel.from_single_file(hf_hub_download(DMD_UNET, f), config=BASE_MODEL, subfolder="unet", torch_dtype=dtype)
    except Exception as e:
        errors.append(f"single file: {e}")
    raise RuntimeError("couldn't load the DMD UNet:\n  " + "\n  ".join(errors) +
                       "\nStart with PAINTER=lcm to use the previous painter meanwhile.")


# ---------- the generator ----------
class Generator:
    def __init__(self):
        import numpy as np
        import torch

        self.np, self.torch = np, torch
        self.device = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
        self.dtype = torch.float16 if self.device != "cpu" else torch.float32
        print(f"[gen] painter '{PAINTER}' on {self.device} ...")
        pipe, self.tiny_vae = load_pipe(self.device, self.dtype)
        self.pipe, self.unet, self.full_vae = pipe, pipe.unet, pipe.vae
        self.prediction = pipe.scheduler.config.get("prediction_type", "epsilon")
        self.alphas = pipe.scheduler.alphas_cumprod.to(self.device, torch.float32)
        self.has_ip = True
        self.embeds = {}                                         # prompt -> encoded prompt
        self.noises = {}                                         # (step, shape) -> fixed noise
        self.prev, self.prev_key = None, None
        self.refs = {s: {"style": None, "image": None} for s in ("person", "background")}
        self.ip = {"person": None, "background": None}
        self.ip_scale = {}
        self.lora_key, self.lora_loaded, self.lora_errors = None, set(), {}
        self.cn, self.depth_model, self.depth_range = {}, None, None      # structure, loaded when first used
        self.shape_img, self.shape_ms, self.prev_shape = None, None, None
        self.prev_in, self.motion, self.lean, self.timing, self.t_lap = None, None, None, {}, 0.0
        self.cur_img = None
        self.ip_zero = self.encode_images([Image.new("RGB", (224, 224), (128, 128, 128))]) * 0
        print(f"[gen] ready · prediction={self.prediction}")

    # --- style LoRAs (applied before every frame; only does work when something changed) ---
    def apply_loras(self, t):
        want = collections.OrderedDict()
        for f, w in ((t["lora_a"], t["lora_a_w"]), (t["lora_b"], t["lora_b_w"])):
            if f and w > 0 and f not in self.lora_errors:
                want[f] = want.get(f, 0) + float(w)
        key = tuple(want.items())
        if key == self.lora_key:
            return
        names, weights = [], []
        for f, w in want.items():
            name = re.sub(r"\W", "_", os.path.splitext(f)[0])
            if name not in self.lora_loaded:
                try:
                    t0 = time.perf_counter()
                    self.pipe.load_lora_weights(LORA_DIR, weight_name=f, adapter_name=name)
                    self.lora_loaded.add(name)
                    print(f"[lora] loaded {f} in {time.perf_counter() - t0:.1f} s")
                except Exception as e:
                    self.lora_errors[f] = str(e)[:300]
                    print(f"[lora] couldn't load {f}: {e}")
                    continue
            names.append(name)
            weights.append(w)
        if names:
            self.pipe.enable_lora()
            self.pipe.set_adapters(names, adapter_weights=weights)
        elif self.lora_loaded:
            self.pipe.disable_lora()
        self.lora_key = key
        self.embeds.clear()                                      # LoRAs can change the text encoder too
        self.prev = None

    # --- structure: what holds the body ---
    def controlnet(self, kind):
        if kind not in self.cn:
            t0 = time.perf_counter()
            self.cn[kind] = load_controlnet(kind, self.dtype).to(self.device).eval()
            print(f"[shape] {kind} ControlNet loaded in {time.perf_counter() - t0:.1f} s")
        return self.cn[kind]

    def depth_map(self, x, size=None, smooth=True):
        """Camera frame (-1..1) -> depth map (0..1, near = white, 3 channels), the way the depth ControlNet wants it."""
        torch, F = self.torch, self.torch.nn.functional
        if self.depth_model is None:
            from transformers import AutoModelForDepthEstimation
            self.depth_model = AutoModelForDepthEstimation.from_pretrained(DEPTH_MODEL, torch_dtype=self.dtype).to(self.device).eval()
            self.depth_mean = torch.tensor([0.485, 0.456, 0.406], device=self.device, dtype=self.dtype).view(1, 3, 1, 1)
            self.depth_std = torch.tensor([0.229, 0.224, 0.225], device=self.device, dtype=self.dtype).view(1, 3, 1, 1)
            print("[shape] depth reader loaded")
        oh, ow = size or (HEIGHT, WIDTH)
        h, w = round(min(oh, 518) / 14) * 14, round(min(oh, 518) * ow / oh / 14) * 14   # the model works in 14-pixel patches
        inp = F.interpolate((x + 1) / 2, (h, w), mode="bilinear", align_corners=False)
        d = self.depth_model(pixel_values=(inp - self.depth_mean) / self.depth_std).predicted_depth
        d = F.interpolate(d[:, None].float(), (oh, ow), mode="bilinear", align_corners=False)
        lo, hi = float(d.amin()), float(d.amax())
        if smooth and self.depth_range:                          # smooth the range, so the map doesn't pump
            lo, hi = 0.8 * self.depth_range[0] + 0.2 * lo, 0.8 * self.depth_range[1] + 0.2 * hi
        if smooth:
            self.depth_range = (lo, hi)
        d = ((d - lo) / max(1e-6, hi - lo)).clamp(0, 1)
        return d.repeat(1, 3, 1, 1).to(self.dtype)

    def pose_cond(self, pose, age):
        """The skeleton the pose ControlNet follows: DWPose on the server (body, hands, face) if it's there, else the
        browser's MediaPipe joints. Reshaped to a child's proportions at young ages."""
        sk = dwpose_skeleton(self.cur_img, age) if self.cur_img is not None else None
        if sk is None:
            sk = draw_openpose(pose or [], age=age)
        return (self.torch.from_numpy(self.np.asarray(sk, dtype="float32") / 255).permute(2, 0, 1)[None]).to(self.device, self.dtype)

    def shape_for(self, x, pose, age=None, ramp=1.0):
        """[(controlnet, picture, strength), ...] or None. Young: pose only, reshaped, held loosely; the hold also
        ramps up (RAMP 0 -> 1) while the kid emerges from the baby."""
        kind, strength = TUNE["shape"], float(TUNE["cn_strength"])
        if kind == "off" or strength <= 0:
            self.shape_img = None
            return None
        t0 = time.perf_counter()
        cu = float(TUNE["child_until"])
        if age is not None and age < cu:
            kind = "pose"
            strength *= float(TUNE["child_cn"]) + (1 - float(TUNE["child_cn"])) * max(0.0, age) / max(0.1, cu)
        strength *= 0.25 + 0.75 * max(0.0, min(1.0, ramp))
        out = []
        if kind in ("depth", "both"):
            out.append((self.controlnet("depth"), self.depth_map(x), strength))
        if kind in ("pose", "both"):
            out.append((self.controlnet("pose"), self.pose_cond(pose, age), strength))
        self.shape_img = out[0][1] if len(out) == 1 else self.torch.maximum(out[0][1], out[1][1])
        self.shape_ms = (time.perf_counter() - t0) * 1000
        return out

    def shape_jpeg(self):
        if self.shape_img is None:
            return None
        y = (self.shape_img[0].permute(1, 2, 0).float().clamp(0, 1) * 255).round().byte().cpu().numpy()
        return jpeg_bytes(Image.fromarray(y))

    # --- prompts and references ---
    def embed_mix(self, prompt):
        """A prompt, or (a, b, mix): the two encoded prompts blended, so the avatar can age smoothly between them."""
        if isinstance(prompt, tuple):
            a, b, mix = prompt
            if b and mix > 0.001:
                return self.embed(a) * (1 - mix) + self.embed(b) * mix
            prompt = a
        return self.embed(prompt)

    def embed(self, prompt):
        if prompt not in self.embeds:
            if len(self.embeds) > 32:
                self.embeds.clear()
            with self.torch.no_grad():
                self.embeds[prompt], _ = self.pipe.encode_prompt(prompt, self.device, 1, False)
        return self.embeds[prompt]

    def set_reference(self, side, kind, img):
        self.refs[side][kind] = img
        self.prev = None
        imgs = [im for k, im in self.refs[side].items() if im is not None and not (side == "background" and k == "image")]
        self.ip[side] = self.encode_images(imgs) if imgs else None

    def encode_images(self, imgs):
        """Reference images -> one IP-Adapter embedding (several images are mixed together)."""
        with self.torch.no_grad():
            px = self.pipe.feature_extractor(images=imgs, return_tensors="pt").pixel_values.to(self.device, self.dtype)
            e = self.pipe.image_encoder(px, output_hidden_states=True).hidden_states[-2]
            return e.mean(0, keepdim=True)[:, None]                   # (1, 1, ...)

    # Where a reference image acts inside the painter (InstantStyle, stage 3). In SD 1.5 the look (colour, texture,
    # brushwork) is carried mostly by the middle attention of the lowest-resolution up block; composition by the
    # down block before it. Putting the reference only there gives its style without its subject.
    # (InstantStyle was worked out on SDXL; these SD 1.5 blocks are the matching ones, worth checking by eye.)
    IP_BLOCKS = {"style": ("up_blocks.1.attentions.1",),
                 "layout": ("up_blocks.1.attentions.1", "down_blocks.2.attentions.1")}

    def set_ip_scales(self, scale, mode, unet=None):
        for name, proc in (unet or self.unet).attn_processors.items():
            if not hasattr(proc, "scale") or not isinstance(proc.scale, list):
                continue                                         # not an IP-Adapter layer
            on = mode == "all" or any(name.startswith(b) for b in self.IP_BLOCKS.get(mode, ()))
            proc.scale = [scale if on else 0.0 for _ in proc.scale]

    def image_embeds(self, side, batch2, unet=None):
        emb = self.ip[side]
        scale = TUNE["ip_style"] if emb is not None else 0.0
        unet = unet or self.unet
        key = (scale, TUNE["ref_mode"])
        if self.ip_scale.get(id(unet)) != key:                  # each painter (UNet) remembers its own setting
            self.set_ip_scales(scale, TUNE["ref_mode"], unet)
            self.ip_scale[id(unet)] = key
        e = emb if emb is not None else self.ip_zero
        return [self.torch.cat([self.ip_zero, e])] if batch2 else [e]

    # --- painting ---
    def noise(self, i, shape, seed=None):
        torch = self.torch
        if seed is not None:
            g = torch.Generator("cpu").manual_seed(seed + i)
            return torch.randn(shape, generator=g).to(self.device, self.dtype)
        key = (i, tuple(shape))
        if key not in self.noises:
            g = torch.Generator("cpu").manual_seed(SEED + i)
            self.noises[key] = torch.randn(shape, generator=g).to(self.device, self.dtype)
        return self.noises[key]

    def denoise(self, lat, timesteps, prompt, side, seed=None, control=None, size=None):
        """Noise up to t, predict the clean picture, repeat at a lower t. One timestep = one-step painting."""
        torch = self.torch
        h, w = size or (HEIGHT, WIDTH)
        x0 = lat if lat is not None else torch.zeros((1, 4, h // 8, w // 8), device=self.device, dtype=self.dtype)
        g = float(TUNE["guidance"])
        cfg = g > 1.01
        text = self.embed_mix(prompt)
        if cfg:
            neg = ", ".join(p for p in (TUNE["negative"], current_style().get("negative", "")) if p)
            text = torch.cat([self.embed(neg), text])
        kw = {"added_cond_kwargs": {"image_embeds": self.image_embeds(side, cfg)}}
        for i, t in enumerate(timesteps):
            a = self.alphas[t]
            sa, s1a = a.sqrt().to(self.dtype), (1 - a).sqrt().to(self.dtype)
            noisy = sa * x0 + s1a * self.noise(i, x0.shape, seed)
            inp = torch.cat([noisy, noisy]) if cfg else noisy
            tt = torch.tensor([t] * inp.shape[0], device=self.device)
            extra = {}
            if control:                                          # ControlNet(s): the shape, added inside the painter
                down = mid = None
                for cn, cond, scale in control:
                    d, m = cn(inp, tt, encoder_hidden_states=text, controlnet_cond=torch.cat([cond, cond]) if cfg else cond,
                              conditioning_scale=scale, return_dict=False)
                    down = d if down is None else [a + b for a, b in zip(down, d)]
                    mid = m if mid is None else mid + m
                extra = {"down_block_additional_residuals": down, "mid_block_additional_residual": mid}
            out = self.unet(inp, tt, encoder_hidden_states=text, **kw, **extra).sample
            if cfg:
                u, c = out.chunk(2)
                out = u + g * (c - u)
            x0 = sa * noisy - s1a * out if self.prediction == "v_prediction" else (noisy - s1a * out) / sa
        return x0

    def lap(self, name):
        """Time since the last lap, for the readout (waits for the GPU, so the numbers are real)."""
        if self.device == "cuda":
            self.torch.cuda.synchronize()
        now = time.perf_counter()
        self.timing[name] = (now - self.t_lap) * 1000
        self.t_lap = now

    def person(self, img, prompt, pose=None, age=None, ramp=1.0):
        """One avatar frame. Steadiness (stage 4): the SAME noise every frame (so the style can't wander), and the
        frame leans on the previous one by STEADY when you're still, letting go as you move (GHOST GUARD)."""
        change, steady, guard = float(TUNE["change"]), float(TUNE["steady"]), float(TUNE["ghost_guard"])
        t1 = int(max(1, min(999, round(change * 1000) - 1)))
        ts = [t1]                                                # one step, live
        self.timing, self.t_lap = {}, time.perf_counter()
        with self.torch.no_grad():
            x = self.to_tensor(img)
            self.cur_img = img
            control = self.shape_for(x, pose, age, ramp)
            self.lap("shape")
            lat = self.tiny_vae.encode(x).latents
            if self.prev_shape != TUNE["shape"]:
                self.prev, self.prev_shape = None, TUNE["shape"]
            same = self.prev is not None and self.prev.shape == lat.shape     # also across prompt changes: an ageing face morphs
            # how much you moved since the last frame (in the tiny VAE's space; ~0.05 = still, 0.3+ = moving)
            motion = float((lat - self.prev_in).abs().mean()) if same and self.prev_in is not None else 1.0
            w = steady / (1 + motion * (2 + 18 * guard)) if same else 0.0
            self.motion, self.lean = motion, w
            self.prev_in = lat
            if w > 0:
                lat = (1 - w) * lat + w * self.prev               # start partly from the last result: the look carries over
            self.lap("encode")
            x0 = self.denoise(lat, ts, prompt, "person", control=control)
            self.lap("paint")
            if w > 0:
                x0 = w * self.prev + (1 - w) * x0                 # and land close to it, so it doesn't jump
            self.prev, self.prev_key = x0, prompt
            y = self.tiny_vae.decode(x0).sample
            self.lap("decode")
        return self.to_image(y)

    last_world = None

    def background(self, prompt, seed, keep=0.0):
        """keep > 0: paint the new world FROM the last one (that much of it survives), so places change, not jump."""
        init, k = self.refs["background"]["image"], BG_IMAGE_KEEP
        if keep > 0 and self.last_world is not None:
            init, k = self.last_world, keep
        sf = self.full_vae.config.scaling_factor
        n = max(1, min(4, int(TUNE["world_steps"])))
        with self.torch.no_grad():
            if init is not None:                                 # start from the last world / the reference picture
                img = ImageOps.fit(init, (WORLD_W, WORLD_H))
                lat = self.full_vae.encode(self.to_tensor(img)).latent_dist.mean * sf
                t0 = int((1 - k) * 1000) - 1
                ts = [int(t0 * (n - k) / n) for k in range(n)]
            else:                                                # start from pure noise
                lat = None
                ts = [int(999 * (n - k) / n) for k in range(n)]      # 1: [999]  2: [999, 499]  4: [999, 749, 499, 249]
            x0 = self.denoise(lat, ts, prompt, "background", seed=seed, size=(WORLD_H, WORLD_W))
            y = self.full_vae.decode(x0 / sf).sample
            if self.torch.isnan(y).any():                        # fp16 trouble: fall back to the tiny VAE
                y = self.tiny_vae.decode(x0).sample
        self.last_world = self.to_image(y)
        return self.last_world

    def portrait(self, prompt, seed, init=None, strength=0.4):
        """The baby: painted once (init None), then repainted lightly from the last one as each trait emerges."""
        sf = self.full_vae.config.scaling_factor
        n = max(1, min(4, int(TUNE["world_steps"])))
        with self.torch.no_grad():
            if init is not None:
                lat = self.full_vae.encode(self.to_tensor(ImageOps.fit(init, (PORTRAIT, PORTRAIT)))).latent_dist.mean * sf
                t0 = int(max(0.05, min(0.95, strength)) * 1000) - 1
            else:
                lat, t0 = None, 999
            ts = [int(t0 * (n - k) / n) for k in range(n)]
            x0 = self.denoise(lat, ts, prompt, "person", seed=seed, size=(PORTRAIT, PORTRAIT))
            y = self.full_vae.decode(x0 / sf).sample
        return self.to_image(y)

    def world_depth(self, img):
        """A depth map of a world picture (near = white), for the browser's parallax. Grey PNG, half size."""
        with self.torch.no_grad():
            d = self.depth_map(self.to_tensor(img), size=(img.height, img.width), smooth=False)
        return depth_png((d[0, 0].float().clamp(0, 1) * 255).round().byte().cpu().numpy(), img.size)

    def gpu_mb(self):
        if self.device != "cuda":
            return None
        return round(self.torch.cuda.memory_allocated() / 1e6), round(self.torch.cuda.get_device_properties(0).total_memory / 1e6)

    def to_tensor(self, img):
        x = self.torch.from_numpy(self.np.asarray(img.convert("RGB"), dtype="float32")).permute(2, 0, 1)[None]
        return (x / 127.5 - 1).to(self.device, self.dtype)

    def to_image(self, y):
        y = ((y.clamp(-1, 1)[0].permute(1, 2, 0).float() + 1) * 127.5).round().byte().cpu().numpy()
        return Image.fromarray(y)


# ---------- SDXL (PAINTER=sdxl) ----------
def load_sdxl(device, dtype):
    """Two SDXL painters sharing one VAE: SDXL-Turbo for the live avatar (1 step), DreamShaper XL Lightning for the worlds
    and the baby (4 steps), plus the tiny SDXL decoder for live frames and IP-Adapter Plus (ViT-H) on both."""
    from diffusers import AutoencoderKL, AutoencoderTiny, StableDiffusionXLPipeline
    vae = AutoencoderKL.from_pretrained(SDXL_VAE, torch_dtype=dtype)

    def get(repo):
        try:
            return StableDiffusionXLPipeline.from_pretrained(repo, torch_dtype=dtype, variant="fp16", vae=vae)
        except Exception:
            return StableDiffusionXLPipeline.from_pretrained(repo, torch_dtype=dtype, vae=vae)
    print(f"[sdxl] live painter {SDXL_LIVE} ...")
    live = get(SDXL_LIVE)
    print(f"[sdxl] world painter {SDXL_WORLD} ...")
    world = get(SDXL_WORLD)
    print("[sdxl] IP-Adapter Plus (ViT-H) ...")
    live.load_ip_adapter(SDXL_IP[0], subfolder=SDXL_IP[1], weight_name=SDXL_IP[2], image_encoder_folder=SDXL_IP[3])
    world.load_ip_adapter(SDXL_IP[0], subfolder=SDXL_IP[1], weight_name=SDXL_IP[2], image_encoder_folder=None)
    tiny = AutoencoderTiny.from_pretrained(SDXL_TINY, torch_dtype=dtype)
    for x in (live, world, tiny):
        x.to(device)
    for x in (live, world):
        x.set_progress_bar_config(disable=True)
    return live, world, tiny


def load_sdxl_controlnet(kind, dtype=None):
    from diffusers import ControlNetModel
    try:
        return ControlNetModel.from_pretrained(SDXL_CONTROLNETS[kind], torch_dtype=dtype, variant="fp16")
    except Exception:
        return ControlNetModel.from_pretrained(SDXL_CONTROLNETS[kind], torch_dtype=dtype)


class SDXLGenerator(Generator):
    """The same avatar loop as the SD 1.5 painter (steadiness, ControlNet, references, ageing), on SDXL.
    Avatar 768x448 with SDXL-Turbo in one step; worlds 1344x768 and the baby 768x768 with DreamShaper XL Lightning, 4 steps."""
    IP_BLOCKS = {"style": ("up_blocks.0.attentions.1",),             # InstantStyle's own SDXL blocks
                 "layout": ("up_blocks.0.attentions.1", "down_blocks.2.attentions.1")}

    def __init__(self):
        import numpy as np
        import torch
        self.np, self.torch = np, torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        if self.device != "cuda":
            raise RuntimeError("SDXL needs the NVIDIA GPU")
        self.dtype = torch.float16
        live, world, self.tiny_vae = load_sdxl(self.device, self.dtype)
        self.pipe, self.world_pipe = live, world
        self.unet, self.world_unet, self.full_vae = live.unet, world.unet, live.vae
        self.prediction = live.scheduler.config.get("prediction_type", "epsilon")
        self.alphas = live.scheduler.alphas_cumprod.to(self.device, torch.float32)
        self.has_ip = True
        self.embeds, self.noises = {}, {}
        self.prev, self.prev_key = None, None
        self.refs = {sd: {"style": None, "image": None} for sd in ("person", "background")}
        self.ip = {"person": None, "background": None}
        self.ip_scale = {}
        self.lora_key, self.lora_loaded, self.lora_errors = None, set(), {}
        self.cn, self.depth_model, self.depth_range = {}, None, None
        self.shape_img, self.shape_ms, self.prev_shape = None, None, None
        self.prev_in, self.motion, self.lean, self.timing, self.t_lap = None, None, None, {}, 0.0
        self.cur_img, self.last_world = None, None
        self.ip_zero = self.encode_images([Image.new("RGB", (224, 224), (128, 128, 128))]) * 0
        for kind in ("depth", "pose"):                              # loaded now, so the first frames don't stall
            self.controlnet(kind)
        print(f"[sdxl] ready · avatar {WIDTH}x{HEIGHT} · world {WORLD_W}x{WORLD_H}")

    def apply_loras(self, t):                                       # the LoRAs in loras/ are SD 1.5: they don't fit SDXL
        for f, w in ((t["lora_a"], t["lora_a_w"]), (t["lora_b"], t["lora_b_w"])):
            if f and w > 0:
                self.lora_errors[f] = "an SD 1.5 LoRA: it doesn't work with the SDXL painter (start the server without PAINTER=sdxl to use it)"

    def controlnet(self, kind):
        if kind not in self.cn:
            t0 = time.perf_counter()
            self.cn[kind] = load_sdxl_controlnet(kind, self.dtype).to(self.device).eval()
            print(f"[shape] SDXL {kind} ControlNet loaded in {time.perf_counter() - t0:.1f} s")
        return self.cn[kind]

    def embed(self, prompt, which="live"):
        key = (which, prompt)
        if key not in self.embeds:
            if len(self.embeds) > 48:
                self.embeds.clear()
            pipe = self.pipe if which == "live" else self.world_pipe
            with self.torch.no_grad():
                pe, _, pooled, _ = pipe.encode_prompt(prompt=prompt, device=self.device, num_images_per_prompt=1,
                                                      do_classifier_free_guidance=False)
            self.embeds[key] = (pe, pooled)
        return self.embeds[key]

    def embed_mix(self, prompt, which="live"):
        if isinstance(prompt, tuple):
            a, b, mix = prompt
            if b and mix > 0.001:
                (pa, qa), (pb, qb) = self.embed(a, which), self.embed(b, which)
                return pa * (1 - mix) + pb * mix, qa * (1 - mix) + qb * mix
            prompt = a
        return self.embed(prompt, which)

    def denoise(self, lat, timesteps, prompt, side, seed=None, control=None, size=None, unet=None, guidance=None, which="live"):
        """SDXL, deterministic (DDIM): noise once up to the first t, then predict and step down. One timestep = one step."""
        torch = self.torch
        unet = unet or self.unet
        h, w = (lat.shape[2] * 8, lat.shape[3] * 8) if lat is not None else (size or (HEIGHT, WIDTH))
        x0 = lat if lat is not None else torch.zeros((1, 4, h // 8, w // 8), device=self.device, dtype=self.dtype)
        g = float(TUNE["guidance"]) if guidance is None else guidance
        cfg = g > 1.01
        pe, pooled = self.embed_mix(prompt, which)
        tid = torch.tensor([[h, w, 0, 0, h, w]], device=self.device, dtype=self.dtype)
        if cfg:
            neg = ", ".join(q for q in (TUNE["negative"], current_style().get("negative", "")) if q)
            npe, npool = self.embed(neg, which)
            pe, pooled, tid = torch.cat([npe, pe]), torch.cat([npool, pooled]), torch.cat([tid, tid])
        added = {"text_embeds": pooled, "time_ids": tid, "image_embeds": self.image_embeds(side, cfg, unet)}
        a = self.alphas[timesteps[0]]
        x = a.sqrt().to(self.dtype) * x0 + (1 - a).sqrt().to(self.dtype) * self.noise(0, x0.shape, seed)
        for i, t in enumerate(timesteps):
            a = self.alphas[t]
            sa, s1a = a.sqrt().to(self.dtype), (1 - a).sqrt().to(self.dtype)
            inp = torch.cat([x, x]) if cfg else x
            tt = torch.tensor([t] * inp.shape[0], device=self.device)
            extra = {}
            if control:
                down = mid = None
                for cn, cond, scale in control:
                    d, m = cn(inp, tt, encoder_hidden_states=pe, controlnet_cond=torch.cat([cond, cond]) if cfg else cond,
                              conditioning_scale=scale, added_cond_kwargs={"text_embeds": pooled, "time_ids": tid}, return_dict=False)
                    down = d if down is None else [p + q for p, q in zip(down, d)]
                    mid = m if mid is None else mid + m
                extra = {"down_block_additional_residuals": down, "mid_block_additional_residual": mid}
            out = unet(inp, tt, encoder_hidden_states=pe, added_cond_kwargs=added, **extra).sample
            if cfg:
                u, c = out.chunk(2)
                out = u + g * (c - u)
            if self.prediction == "v_prediction":
                x0, eps = sa * x - s1a * out, s1a * x + sa * out
            else:
                x0, eps = (x - s1a * out) / sa, out
            if i + 1 < len(timesteps):
                a2 = self.alphas[timesteps[i + 1]]
                x = a2.sqrt().to(self.dtype) * x0 + (1 - a2).sqrt().to(self.dtype) * eps
        return x0

    def paint_big(self, prompt, seed, init, k, size, side):
        """A world or the baby: DreamShaper XL Lightning, 4 steps, CFG 2 (from init, keeping k of it, if given)."""
        sf = self.full_vae.config.scaling_factor
        n = SDXL_WORLD_STEPS
        with self.torch.no_grad():
            if init is not None:
                img = ImageOps.fit(init.convert("RGB"), (size[1], size[0]))
                lat = self.full_vae.encode(self.to_tensor(img)).latent_dist.mean * sf
                t0 = int((1 - k) * 1000) - 1
            else:
                lat, t0 = None, 999
            ts = [int(t0 * (n - j) / n) for j in range(n)]
            x0 = self.denoise(lat, ts, prompt, side, seed=seed, size=size, unet=self.world_unet, guidance=SDXL_WORLD_CFG, which="world")
            y = self.full_vae.decode(x0 / sf).sample
        return self.to_image(y)

    def background(self, prompt, seed, keep=0.0):
        init, k = self.refs["background"]["image"], BG_IMAGE_KEEP
        if keep > 0 and self.last_world is not None:
            init, k = self.last_world, keep
        self.last_world = self.paint_big(prompt, seed, init, k, (WORLD_H, WORLD_W), "background")
        return self.last_world

    def portrait(self, prompt, seed, init=None, strength=0.4):
        return self.paint_big(prompt, seed, init, 1 - strength, (PORTRAIT, PORTRAIT), "person")


class MockGenerator:
    """No model: fake effects so the pages and the loop can be tested."""
    has_ip = True

    def __init__(self):
        self.refs = {s: {"style": None, "image": None} for s in ("person", "background")}
        self.lora_errors = {}
        self.lora_key = None

    def apply_loras(self, t):
        self.lora_key = (t["lora_a"], t["lora_a_w"], t["lora_b"], t["lora_b_w"])

    shape_img, shape_ms, motion, lean = None, None, None, None
    timing = {}

    def shape_jpeg(self):
        return jpeg_bytes(self.shape_img) if self.shape_img is not None else None

    def gpu_mb(self):
        return None

    @staticmethod
    def tint(prompt):
        if isinstance(prompt, tuple):                            # (a, b, mix): blend the two colours
            a, b, m = prompt
            ca, cb = MockGenerator.tint(a), MockGenerator.tint(b)
            return tuple(int(x * (1 - m) + y * m) for x, y in zip(ca, cb))
        h = zlib.crc32(prompt.encode())
        return ((h >> 16) & 255, (h >> 8) & 255, h & 255)

    def set_reference(self, side, kind, img):
        self.refs[side][kind] = img

    def ref_colour(self, side, fallback):
        imgs = [im for im in self.refs[side].values() if im is not None]
        if not imgs:
            return fallback
        return tuple(int(v) for v in ImageStat.Stat(imgs[0].convert("RGB")).mean)

    def person(self, img, prompt, pose=None, age=None, ramp=1.0):
        time.sleep(0.05)
        kind = TUNE["shape"]
        self.shape_img = None if kind == "off" else (draw_openpose(pose or []) if kind == "pose" else
                                                     ImageOps.autocontrast(ImageOps.grayscale(img).filter(ImageFilter.GaussianBlur(4))).convert("RGB"))
        self.timing = {"shape": 3.0, "encode": 2.0, "paint": 40.0, "decode": 3.0}
        self.motion, self.lean = 0.1, float(TUNE["steady"]) / 2
        c = self.ref_colour("person", self.tint(prompt))
        g = ImageOps.colorize(ImageOps.grayscale(ImageOps.posterize(img, 3)), black=(20, 10, 40), white=c)
        return Image.blend(img, g, min(1.0, float(TUNE["change"])))

    last_world = None

    def background(self, prompt, seed, keep=0.0):
        time.sleep(0.3)
        init = self.refs["background"]["image"]
        if init is not None:
            img = ImageOps.fit(init.convert("RGB"), (WORLD_W, WORLD_H)).filter(ImageFilter.GaussianBlur(3))
        else:
            rnd, c = random.Random(seed), self.ref_colour("background", self.tint(prompt))
            img = Image.new("RGB", (WORLD_W, WORLD_H), c)
            d = ImageDraw.Draw(img)
            for _ in range(30):
                x, y, r = rnd.randrange(WORLD_W), rnd.randrange(WORLD_H), rnd.randrange(10, 80)
                d.ellipse((x - r, y - r, x + r, y + r), fill=tuple(min(255, max(0, v + rnd.randrange(-60, 60))) for v in c))
            img = img.filter(ImageFilter.GaussianBlur(6))
        if keep > 0 and self.last_world is not None:            # grows out of the last world
            img = Image.blend(img, self.last_world, keep)
        self.last_world = img.copy()
        ImageDraw.Draw(img).text((12, WORLD_H - 24), "MOCK WORLD · " + prompt[:70], fill=(255, 255, 255))
        return img

    def portrait(self, prompt, seed, init=None, strength=0.4):
        """A drawn stand-in baby: a face with eyes, tinted by the prompt, so the page's animation has something to work on."""
        time.sleep(0.25)
        n, c = PORTRAIT, self.tint(prompt)
        img = Image.new("RGB", (n, n), (235, 225, 215))
        d = ImageDraw.Draw(img)
        d.ellipse((n * 0.12, n * 0.62, n * 0.88, n * 1.2), fill=(240, 240, 250))              # blanket
        d.ellipse((n * 0.28, n * 0.18, n * 0.72, n * 0.7), fill=(min(255, c[0] // 2 + 150), min(255, c[1] // 3 + 140), min(255, c[2] // 3 + 120)))
        for ex in (0.41, 0.59):
            d.ellipse((n * (ex - 0.04), n * 0.4, n * (ex + 0.04), n * 0.45), fill=(255, 255, 255))
            d.ellipse((n * (ex - 0.018), n * 0.405, n * (ex + 0.018), n * 0.445), fill=(60, 40, 30))
        d.text((10, n - 20), "MOCK BABY · " + prompt[-60:], fill=(80, 80, 80))
        if init is not None:
            img = Image.blend(ImageOps.fit(init, (n, n)), img, max(0.2, strength))
        return img

    def world_depth(self, img):
        """Mock depth: lower = nearer, plus a little of the picture's brightness."""
        import numpy as np
        h, w = img.height, img.width
        grad = np.linspace(40, 230, h)[:, None].repeat(w, 1)
        lum = np.asarray(ImageOps.grayscale(img), dtype="float32")
        return depth_png(np.clip(grad * 0.8 + lum * 0.2, 0, 255).astype("uint8"), img.size)


gen = None
painter_note = ""
lock = asyncio.Lock()
frame_log = collections.deque(maxlen=60)          # (time, ms, {part: ms}) of recent avatar frames, for the readout
rtt_log = collections.deque(maxlen=30)            # the browser's measured round trip per frame (ms)
wait_log = collections.deque(maxlen=30)           # how long each frame queued behind the previous one on the server (ms)
world_ms = None


def depth_png(arr, size):
    g = Image.fromarray(arr, "L").resize((max(2, size[0] // 2), max(2, size[1] // 2)))
    buf = io.BytesIO()
    g.save(buf, "PNG")
    return buf.getvalue()


def jpeg_bytes(img):
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    return buf.getvalue()


def full_prompt(prompt):
    """The stage / lab prompt + the look's words + the trigger words of the LoRAs that are on + the style prompt."""
    parts = [prompt, current_style().get("prompt", "")]
    for f, w in ((TUNE["lora_a"], TUNE["lora_a_w"]), (TUNE["lora_b"], TUNE["lora_b_w"])):
        if f and w > 0:
            parts.append(trigger_words(f))
    parts.append(TUNE["style_prompt"])
    return ", ".join(p.strip() for p in parts if p and p.strip())


def run_person(jpeg, prompt, pose=None, to="", mix=0.0, age=None, ramp=1.0):
    t0 = time.perf_counter()
    gen.apply_loras(TUNE)
    img = Image.open(io.BytesIO(jpeg)).convert("RGB")
    if img.size != (WIDTH, HEIGHT):
        img = ImageOps.fit(img, (WIDTH, HEIGHT))
    t1 = time.perf_counter()
    p = (full_prompt(prompt), full_prompt(to), mix) if to and mix > 0.001 else full_prompt(prompt)
    out = gen.person(img, p, pose, age, ramp)
    t2 = time.perf_counter()
    data = jpeg_bytes(out)
    t3 = time.perf_counter()
    parts = dict(getattr(gen, "timing", {}) or {})
    parts["jpeg"] = ((t1 - t0) + (t3 - t2)) * 1000                # reading the camera frame + writing the result
    ms = (t3 - t0) * 1000
    frame_log.append((time.time(), ms, parts))
    return data, ms


world_seq, world_last = 0, {"id": 0, "img": None, "depth": None}


def run_background(prompt, seed, keep=0.0):
    global world_ms, world_seq
    t0 = time.perf_counter()
    gen.apply_loras(TUNE)
    out = gen.background(full_prompt(prompt), seed, keep)
    world_ms = (time.perf_counter() - t0) * 1000
    world_seq += 1
    world_last.update(id=world_seq, img=out, depth=None)          # its depth is made when the page asks (GET /world_depth)
    return jpeg_bytes(out), world_ms


def run_world_depth(wid):
    if wid != world_last["id"] or world_last["img"] is None:
        return None
    if world_last["depth"] is None:
        world_last["depth"] = gen.world_depth(world_last["img"])
    return world_last["depth"]


portrait_last = {"img": None}


def run_portrait(prompt, seed, base, strength):
    init = portrait_last["img"] if base else None
    out = gen.portrait(full_prompt(prompt), seed, init, strength)
    portrait_last["img"] = out
    return jpeg_bytes(out)


# ---------- web ----------
@app.on_event("startup")
async def load():
    global gen
    if not MOCK:
        await asyncio.to_thread(download_loras)
    global PAINTER, painter_note
    if MOCK:
        gen = MockGenerator()
    elif PAINTER == "sdxl":
        try:
            gen = await asyncio.to_thread(SDXLGenerator)
        except Exception as e:                                       # don't lose the session: fall back to the SD 1.5 painter
            import traceback
            traceback.print_exc()
            painter_note = f"SDXL didn't load ({str(e)[:160]}); running the SD 1.5 DMD painter instead"
            print("[sdxl] " + painter_note)
            PAINTER = "dmd"
            set_sizes(PAINTER)
            gen = await asyncio.to_thread(Generator)
    else:
        gen = await asyncio.to_thread(Generator)
    if not MOCK:
        await asyncio.to_thread(dwpose)
    if not MOCK:   # warm up so the first real frames aren't slow
        await asyncio.to_thread(run_background, "warm up", 0)
        await asyncio.to_thread(run_person, jpeg_bytes(Image.new("RGB", (WIDTH, HEIGHT), (128, 128, 128))), "warm up")
        frame_log.clear()
    print(f"open http://localhost:{PORT}   (tuning: http://localhost:{PORT}/panel)" + ("   (MOCK mode)" if MOCK else ""))


@app.get("/game")
async def game():
    return FileResponse(os.path.join(HERE, "web", "game.html"))


@app.get("/panel")
async def panel():
    return FileResponse(os.path.join(HERE, "web", "panel.html"))


# ---------- chance ----------
_rand_backoff = 0.0


def draw_ints(n, lo, hi):
    """n whole numbers from lo to hi (inclusive). random.org first, local randomness if that fails."""
    global _rand_backoff
    if RANDOM_ORG_KEY and time.time() > _rand_backoff:
        try:
            body = json.dumps({"jsonrpc": "2.0", "method": "generateIntegers", "id": 1,
                               "params": {"apiKey": RANDOM_ORG_KEY, "n": n, "min": lo, "max": hi, "replacement": True}}).encode()
            req = urllib.request.Request("https://api.random.org/json-rpc/4/invoke", body, {"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as r:
                data = json.loads(r.read())
            if "error" in data:
                raise RuntimeError(data["error"].get("message"))
            return data["result"]["random"]["data"], "RANDOM.ORG"
        except Exception as e:
            print("[chance] random.org failed, using local randomness for 30 s:", e)
            _rand_backoff = time.time() + 30
    return [lo + secrets.randbelow(hi - lo + 1) for _ in range(n)], "LOCAL"


@app.get("/draw")
async def draw(n: int = 1, lo: int = 1, hi: int = 6):
    n, lo, hi = max(1, min(50, n)), int(lo), int(hi)
    values, source = await asyncio.to_thread(draw_ints, n, lo, max(lo, hi))
    return {"values": values, "source": source}


@app.get("/config")
async def config():
    return {"width": WIDTH, "height": HEIGHT, "mock": MOCK, "engine": "mock" if MOCK else PAINTER,
            "references": True, "look": look_version, "tune": tune_version, "shape": TUNE["shape"],
            "filter": current_style().get("filter", ""), "skip_still": TUNE["skip_still"], "pace": pace_version,
            "out_scale": 2, "world_w": WORLD_W, "world_h": WORLD_H, "parallax": TUNE["parallax"],
            "server_pose": bool(_wb["model"]) or MOCK}


# ---------- tuning ----------
def clean_tune(d):
    """Only known keys, with sane types and ranges."""
    out = {}
    rng = {"change": (0.1, 1.0), "world_steps": (1, 4), "lora_a_w": (0, 2), "lora_b_w": (0, 2),
           "ip_style": (0, 1.5), "guidance": (1, 4), "steady": (0, 0.9), "cn_strength": (0, 1.5),
           "ghost_guard": (0, 1), "skip_still": (0, 10), "child_until": (0, 20), "child_cn": (0, 1), "parallax": (0, 0.1)}
    for k, v in d.items():
        if k not in TUNE_DEFAULTS:
            continue
        if k in rng:
            try:
                v = max(rng[k][0], min(rng[k][1], float(v)))
            except (TypeError, ValueError):
                continue
            if k == "world_steps":
                v = int(round(v))
        else:
            v = str(v)[:400]
            if k in ("lora_a", "lora_b") and v and v not in list_loras():
                v = ""
            if k == "shape" and v not in ("depth", "pose", "both", "off"):
                continue
            if k == "style" and v not in load_styles():
                continue
            if k == "ref_mode" and v not in ("style", "layout", "all"):
                continue
        out[k] = v
    return out


def settings_view():
    now = time.time()
    recent = [(t, ms) for t, ms, _ in frame_log if now - t < 3]
    parts = {}
    for t_, _, p in frame_log:
        if now - t_ < 3:
            for k, v in p.items():
                parts.setdefault(k, []).append(v)
    parts = {k: round(sum(v) / len(v), 1) for k, v in parts.items()}
    avg_ms = sum(ms for _, ms in recent) / len(recent) if recent else None
    rtt = sum(rtt_log) / len(rtt_log) if rtt_log else None
    wait = sum(wait_log) / len(wait_log) if wait_log else 0
    if parts:
        parts["queue"] = round(wait, 1)
    fps = (len(recent) - 1) / (recent[-1][0] - recent[0][0]) if len(recent) > 2 and recent[-1][0] > recent[0][0] else 0
    mem = gen.gpu_mb() if gen else None
    return {
        "tune": TUNE, "defaults": TUNE_DEFAULTS, "look": look_version,
        "styles": [{"id": k, "name": v.get("name", k), "prompt": v.get("prompt", ""), "filter": v.get("filter", ""),
                    "lora": v.get("lora")} for k, v in load_styles().items()],
        "loras": [{"file": f, "trigger": trigger_words(f), "error": (gen.lora_errors.get(f) if gen else None)} for f in list_loras()],
        "readout": {
            "painter": "mock" if MOCK else PAINTER,
            "painter_note": painter_note,
            "detection": ("DWPose on " + _wb["where"]) if _wb["model"] else ("browser MediaPipe" + (f" (DWPose: {_wb['error']})" if _wb["error"] else "")),
            "fps": round(fps, 1),
            "ms": round(sum(ms for _, ms in recent) / len(recent)) if recent else None,
            "world_ms": round(world_ms) if world_ms else None,
            "gpu_mb": mem[0] if mem else None, "gpu_total_mb": mem[1] if mem else None,
            "shape_ms": round(gen.shape_ms, 1) if gen and gen.shape_ms else None,
            "parts": parts,                                      # server time per frame, by step (ms)
            "network_ms": max(0, round(rtt - avg_ms - wait)) if rtt and avg_ms else None,   # round trip minus server time and queueing
            "motion": round(gen.motion, 3) if gen and gen.motion is not None else None,
            "lean": round(gen.lean, 2) if gen and gen.lean is not None else None,
            "ready": gen is not None,
        },
    }


@app.get("/settings")
async def get_settings():
    return settings_view()


@app.post("/settings")
async def post_settings(request: Request):
    global look_version, tune_version
    new = clean_tune(await request.json())
    if any(TUNE.get(k) != v for k, v in new.items() if k in LOOK_KEYS):
        look_version += 1
    if any(TUNE.get(k) != v for k, v in new.items()):
        tune_version += 1
    TUNE.update(new)
    return settings_view()


@app.get("/shape")
async def shape():
    """The depth map or skeleton the painter followed in the last avatar frame (for /panel)."""
    data = await asyncio.to_thread(gen.shape_jpeg) if gen else None
    if not data:
        return Response(status_code=204)
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.post("/redraw")
async def redraw():
    """Ask every open page to repaint the world (same prompt, new look)."""
    global look_version
    look_version += 1
    return {"look": look_version}


def preset_path(name):
    name = re.sub(r"[^\w\- ]", "", name).strip()[:40]
    return os.path.join(PRESET_DIR, name + ".json") if name else None


@app.get("/presets")
async def presets():
    os.makedirs(PRESET_DIR, exist_ok=True)
    return sorted(f[:-5] for f in os.listdir(PRESET_DIR) if f.endswith(".json"))


@app.post("/presets")
async def save_preset(name: str):
    p = preset_path(name)
    if not p:
        return JSONResponse({"error": "give it a name"}, status_code=400)
    os.makedirs(PRESET_DIR, exist_ok=True)
    with open(p, "w") as fh:
        json.dump(TUNE, fh, indent=2)
    return {"saved": os.path.basename(p)[:-5]}


@app.get("/presets/{name}")
async def load_preset(name: str):
    global look_version, tune_version
    p = preset_path(name)
    if not p or not os.path.exists(p):
        return JSONResponse({"error": "no such preset"}, status_code=404)
    with open(p) as fh:
        TUNE.update(clean_tune(json.load(fh)))
    look_version += 1
    tune_version += 1
    return settings_view()


@app.post("/reference")
async def reference(request: Request, side: str, kind: str):
    """Set (image in the body) or clear (empty body) one reference image."""
    global look_version
    if side not in ("person", "background") or kind not in ("style", "image"):
        return Response(status_code=400)
    body = await request.body()
    img = Image.open(io.BytesIO(body)).convert("RGB") if body else None
    async with lock:
        await asyncio.to_thread(gen.set_reference, side, kind, img)
    return {"ok": True, "works": True}


@app.post("/frame")
async def frame(request: Request, prompt: str = "", to: str = "", mix: float = 0.0):
    """One camera frame in (JPEG), the person repainted out (JPEG). All tuning comes from /settings.
    (Older pages still send strength / steady / style in the address: they're ignored now.)"""
    jpeg = await request.body()
    prompt = prompt.strip() or "a person"
    try:                                                         # the browser's round trip for its previous frame
        rtt = float(request.headers.get("X-RTT", "0"))
        if 0 < rtt < 10000:
            rtt_log.append(rtt)
    except ValueError:
        pass
    try:                                                         # the game: the avatar's age (for its proportions) and the takeover ramp
        age = float(request.headers["X-Age"]) if "X-Age" in request.headers else None
        ramp = max(0.0, min(1.0, float(request.headers.get("X-Ramp", "1"))))
    except ValueError:
        age, ramp = None, 1.0
    pose = None
    try:                                                         # pose mode: the browser sends the joints along
        raw = request.headers.get("X-Pose")
        pose = [[float(v) for v in p[:3]] for p in json.loads(raw)][:33] if raw else None
    except (ValueError, TypeError):
        pose = None
    arrived = time.perf_counter()
    async with lock:
        wait_log.append((time.perf_counter() - arrived) * 1000)   # the browser keeps two frames in flight: one waits here
        out, ms = await asyncio.to_thread(run_person, jpeg, prompt, pose, to.strip(), max(0.0, min(1.0, mix)), age, ramp)
    return Response(out, media_type="image/jpeg", headers={"X-Gen-Ms": str(round(ms)), "X-Look": str(look_version), "Cache-Control": "no-store"})


@app.get("/background")
async def background(prompt: str = "", keep: float = 0.0, fresh: int = 0):
    """A world for the prompt (a new random seed every time). keep > 0: painted from the last world, so it grows
    out of it (the game's unfolding). fresh=1: forget the last world first (a new life)."""
    prompt = prompt.strip() or "an empty landscape"
    async with lock:
        if fresh:
            gen.last_world = None
        out, ms = await asyncio.to_thread(run_background, prompt, random.randrange(1 << 30), max(0.0, min(0.95, keep)))
        wid = world_seq
    return Response(out, media_type="image/jpeg", headers={"X-Gen-Ms": str(round(ms)), "X-Look": str(look_version), "X-World": str(wid),
                                                           "Cache-Control": "no-store"})


@app.get("/world_depth")
async def world_depth(id: int = 0):
    """The depth of the last world (grey PNG, near = white), for the page's parallax."""
    async with lock:
        data = await asyncio.to_thread(run_world_depth, id)
    if not data:
        return Response(status_code=204)
    return Response(data, media_type="image/png", headers={"Cache-Control": "no-store"})


@app.get("/portrait")
async def portrait(prompt: str = "", base: int = 0, strength: float = 0.4, seed: int = 0):
    """The baby (Body). base=0: painted fresh; base=1: repainted lightly from the last one (a trait emerging)."""
    prompt = prompt.strip() or "a newborn baby"
    async with lock:
        out = await asyncio.to_thread(run_portrait, prompt, seed or random.randrange(1 << 30), base, max(0.05, min(0.95, strength)))
    return Response(out, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


# ---------- the life (trajectory.json) ----------
def read_trajectory():
    with open(TRAJECTORY_FILE, encoding="utf-8") as fh:
        return json.load(fh)


@app.get("/trajectory")
async def trajectory():
    """The whole life, read fresh from the file every time (so edits show up on the next life)."""
    try:
        return JSONResponse(read_trajectory(), headers={"Cache-Control": "no-store"})
    except (OSError, ValueError) as e:
        return JSONResponse({"error": f"trajectory.json: {e}"}, status_code=500)


@app.post("/trajectory/pacing")
async def save_pacing(request: Request):
    """From /panel: {pacing: {name: seconds}, world: {keep, chapter_keep}} -> written into trajectory.json."""
    global pace_version
    body = await request.json()
    doc = read_trajectory()
    for k, v in (body.get("pacing") or {}).items():
        if k in doc.get("pacing", {}):
            try:
                doc["pacing"][k] = round(max(0.0, min(60.0, float(v))), 2)
            except (TypeError, ValueError):
                pass
    for k, v in (body.get("world") or {}).items():
        if k in doc.get("world", {}):
            try:
                doc["world"][k] = round(max(0.0, min(0.95, float(v))), 2)
            except (TypeError, ValueError):
                pass
    tmp = TRAJECTORY_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, TRAJECTORY_FILE)
    pace_version += 1
    return {"pacing": doc["pacing"], "world": doc["world"], "pace": pace_version}


# the pages (index.html = the lab, game.html, panel.html, live.js, stages.js); mounted last so the routes above win
app.mount("/", StaticFiles(directory=os.path.join(HERE, "web"), html=True), name="web")


if __name__ == "__main__":
    import uvicorn
    print("loading..." + ("   (MOCK mode)" if MOCK else f"  painter '{PAINTER}' (first start downloads models and takes a while)"))
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
