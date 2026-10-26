"""
Live webcam -> diffusion. Runs on the cloud GPU (chance-gpu, NVIDIA L4); also works on a Mac (MPS), slowly.

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
WIDTH, HEIGHT = 640, 384          # output size; both must be multiples of 64
SEED = 7                          # noise used for the live person frames
PAINTER = os.environ.get("PAINTER", "dmd")
MOCK = os.environ.get("MOCK") == "1"

BASE_MODEL = "Lykon/dreamshaper-8"                          # text encoder, VAE, image encoder come from here
DMD_UNET = "aaronb/dreamshaper-8-dmd-1kstep"                # the one-step painter (only the UNet changes)
LCM_LORA = "latent-consistency/lcm-lora-sdv1-5"
IP_ADAPTER = ("h94/IP-Adapter", "models", "ip-adapter-plus_sd15.safetensors")
TINY_VAE = "madebyollin/taesd"
CONTROLNETS = {"depth": "lllyasviel/control_v11f1p_sd15_depth", "pose": "lllyasviel/control_v11p_sd15_openpose"}
DEPTH_MODEL = "depth-anything/Depth-Anything-V2-Small-hf"
BG_IMAGE_KEEP = 0.35              # background IMAGE reference: how much of the picture survives (0.2–0.6)

HERE = os.path.dirname(os.path.abspath(__file__))
LORA_DIR = os.path.join(HERE, "loras")
PRESET_DIR = os.path.join(HERE, "presets")
STYLES_FILE = os.path.join(HERE, "styles.json")      # the looks on /panel (cartoon, caricature, pixel art, ...): edit freely

# style LoRAs fetched on first start (all SD 1.5, none anime). file in loras/ <- (repo, file in repo or None = find it), trigger words
DEFAULT_LORAS = {
    "pixel-art.safetensors": ("artificialguybr/pixelartredmond-1-5v-pixel-art-loras-for-sd-1-5",
                              "PixelArtRedmond15V-PixelArt-PIXARFK.safetensors", "Pixel Art, PixArFK"),
    "sketch.safetensors": ("jordanhilado/sd-1-5-sketch-lora", None, ""),
    "watercolor.safetensors": ("fladdict/watercolor", "fladdict-watercolor-sd-1-5.safetensors", "watercolor painting"),
}

# chance: random.org (true randomness). Falls back to the computer's own randomness if it can't be reached.
RANDOM_ORG_KEY = os.environ.get("RANDOM_ORG_KEY", "")

# ---------- the tuning (changed live from /panel) ----------
TUNE_DEFAULTS = {
    # structure
    "shape": "depth",         # what holds the body: "depth", "pose" or "off"
    "cn_strength": 0.8,       # how strongly ControlNet holds it
    # change
    "change": 0.6,            # how much the avatar is repainted (1.0 = from pure noise: the painter's home ground)
    "world_steps": 2,         # world: painting steps (1 = what DMD is trained for; more = more detail, maybe worse)
    # style
    "style": "cartoon",       # a look from styles.json: words added to every prompt + a browser filter
    "lora_a": "", "lora_a_w": 0.8,
    "lora_b": "", "lora_b_w": 0.5,
    "ip_style": 0.6,          # how strongly STYLE / IMAGE references steer the look
    "style_prompt": "",       # added to every prompt (avatar and world)
    "negative": "photo, realistic, blurry, deformed, extra limbs",
    "guidance": 1.0,          # 1.0 = off (DMD's own). Above 1: the negative prompt works, each frame costs ~2x
    # stability
    "steady": 0.4,            # how much each frame leans on the last one
}
TUNE = dict(TUNE_DEFAULTS)
LOOK_KEYS = {"style", "world_steps", "lora_a", "lora_a_w", "lora_b", "lora_b_w", "ip_style", "style_prompt", "negative", "guidance"}
look_version = 0              # goes up when the look changes, so the pages redraw the world
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


def draw_openpose(points, w=WIDTH, h=HEIGHT):
    """points: MediaPipe's 33 [x, y, visibility] (x, y from 0 to 1). Returns the skeleton on black, as OpenPose draws it."""
    def mp(i):
        if i >= len(points):
            return None
        x, y, v = points[i]
        return (x * w, y * h) if v > 0.5 and -0.05 < x < 1.05 and -0.05 < y < 1.05 else None
    kp = [mp(i) if i is not None else None for i in OP_FROM_MP]
    if kp[2] and kp[5]:
        kp[1] = ((kp[2][0] + kp[5][0]) / 2, (kp[2][1] + kp[5][1]) / 2)
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
        self.ip_scale = None
        self.lora_key, self.lora_loaded, self.lora_errors = None, set(), {}
        self.cn, self.depth_model, self.depth_range = {}, None, None      # structure, loaded when first used
        self.shape_img, self.shape_ms, self.prev_shape = None, None, None
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

    def depth_map(self, x):
        """Camera frame (-1..1) -> depth map (0..1, near = white, 3 channels), the way the depth ControlNet wants it."""
        torch, F = self.torch, self.torch.nn.functional
        if self.depth_model is None:
            from transformers import AutoModelForDepthEstimation
            self.depth_model = AutoModelForDepthEstimation.from_pretrained(DEPTH_MODEL, torch_dtype=self.dtype).to(self.device).eval()
            self.depth_mean = torch.tensor([0.485, 0.456, 0.406], device=self.device, dtype=self.dtype).view(1, 3, 1, 1)
            self.depth_std = torch.tensor([0.229, 0.224, 0.225], device=self.device, dtype=self.dtype).view(1, 3, 1, 1)
            print("[shape] depth reader loaded")
        h, w = round(HEIGHT / 14) * 14, round(WIDTH / 14) * 14   # the model works in 14-pixel patches
        inp = F.interpolate((x + 1) / 2, (h, w), mode="bilinear", align_corners=False)
        d = self.depth_model(pixel_values=(inp - self.depth_mean) / self.depth_std).predicted_depth
        d = F.interpolate(d[:, None].float(), (HEIGHT, WIDTH), mode="bilinear", align_corners=False)
        lo, hi = float(d.amin()), float(d.amax())
        if self.depth_range:                                     # smooth the range, so the map doesn't pump
            lo, hi = 0.8 * self.depth_range[0] + 0.2 * lo, 0.8 * self.depth_range[1] + 0.2 * hi
        self.depth_range = (lo, hi)
        d = ((d - lo) / max(1e-6, hi - lo)).clamp(0, 1)
        return d.repeat(1, 3, 1, 1).to(self.dtype)

    def shape_for(self, x, pose):
        kind = TUNE["shape"]
        if kind == "off" or float(TUNE["cn_strength"]) <= 0:
            self.shape_img = None
            return None
        t0 = time.perf_counter()
        if kind == "depth":
            cond = self.depth_map(x)
        else:
            sk = draw_openpose(pose or [])
            cond = (self.torch.from_numpy(self.np.asarray(sk, dtype="float32") / 255).permute(2, 0, 1)[None]).to(self.device, self.dtype)
        self.shape_img = cond
        self.shape_ms = (time.perf_counter() - t0) * 1000
        return self.controlnet(kind), cond

    def shape_jpeg(self):
        if self.shape_img is None:
            return None
        y = (self.shape_img[0].permute(1, 2, 0).float().clamp(0, 1) * 255).round().byte().cpu().numpy()
        return jpeg_bytes(Image.fromarray(y))

    # --- prompts and references ---
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

    def image_embeds(self, side, batch2):
        emb = self.ip[side]
        scale = TUNE["ip_style"] if emb is not None else 0.0
        if scale != self.ip_scale:
            self.pipe.set_ip_adapter_scale(scale)
            self.ip_scale = scale
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

    def denoise(self, lat, timesteps, prompt, side, seed=None, control=None):
        """Noise up to t, predict the clean picture, repeat at a lower t. One timestep = one-step painting."""
        torch = self.torch
        x0 = lat if lat is not None else torch.zeros((1, 4, HEIGHT // 8, WIDTH // 8), device=self.device, dtype=self.dtype)
        g = float(TUNE["guidance"])
        cfg = g > 1.01
        text = self.embed(prompt)
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
            if control is not None:                              # ControlNet: the shape, added inside the painter
                cn, cond = control
                down, mid = cn(inp, tt, encoder_hidden_states=text, controlnet_cond=torch.cat([cond, cond]) if cfg else cond,
                               conditioning_scale=float(TUNE["cn_strength"]), return_dict=False)
                extra = {"down_block_additional_residuals": down, "mid_block_additional_residual": mid}
            out = self.unet(inp, tt, encoder_hidden_states=text, **kw, **extra).sample
            if cfg:
                u, c = out.chunk(2)
                out = u + g * (c - u)
            x0 = sa * noisy - s1a * out if self.prediction == "v_prediction" else (noisy - s1a * out) / sa
        return x0

    def person(self, img, prompt, pose=None):
        change, steady = float(TUNE["change"]), float(TUNE["steady"])
        t1 = int(max(1, min(999, round(change * 1000) - 1)))
        ts = [t1]                                                # one step, live
        with self.torch.no_grad():
            x = self.to_tensor(img)
            control = self.shape_for(x, pose)
            lat = self.tiny_vae.encode(x).latents
            if self.prev_shape != TUNE["shape"]:
                self.prev, self.prev_shape = None, TUNE["shape"]
            same = self.prev is not None and self.prev_key == prompt and self.prev.shape == lat.shape
            if same and steady > 0:
                # feedback: the new frame starts partly from the last result, so the look carries over
                lat = (1 - steady) * lat + steady * self.prev
            x0 = self.denoise(lat, ts, prompt, "person", control=control)
            if same and steady > 0:
                # and the result is blended a little with the last one, so it doesn't jump
                x0 = (steady * 0.5) * self.prev + (1 - steady * 0.5) * x0
            self.prev, self.prev_key = x0, prompt
            y = self.tiny_vae.decode(x0).sample
        return self.to_image(y)

    def background(self, prompt, seed):
        init = self.refs["background"]["image"]
        sf = self.full_vae.config.scaling_factor
        n = max(1, min(4, int(TUNE["world_steps"])))
        with self.torch.no_grad():
            if init is not None:                                 # start from the reference picture
                img = ImageOps.fit(init, (WIDTH, HEIGHT))
                lat = self.full_vae.encode(self.to_tensor(img)).latent_dist.mean * sf
                t0 = int((1 - BG_IMAGE_KEEP) * 1000) - 1
                ts = [int(t0 * (n - k) / n) for k in range(n)]
            else:                                                # start from pure noise
                lat = None
                ts = [int(999 * (n - k) / n) for k in range(n)]      # 1: [999]  2: [999, 499]  4: [999, 749, 499, 249]
            x0 = self.denoise(lat, ts, prompt, "background", seed=seed)
            y = self.full_vae.decode(x0 / sf).sample
            if self.torch.isnan(y).any():                        # fp16 trouble: fall back to the tiny VAE
                y = self.tiny_vae.decode(x0).sample
        return self.to_image(y)

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


class MockGenerator:
    """No model: fake effects so the pages and the loop can be tested."""
    has_ip = True

    def __init__(self):
        self.refs = {s: {"style": None, "image": None} for s in ("person", "background")}
        self.lora_errors = {}
        self.lora_key = None

    def apply_loras(self, t):
        self.lora_key = (t["lora_a"], t["lora_a_w"], t["lora_b"], t["lora_b_w"])

    shape_img, shape_ms = None, None

    def shape_jpeg(self):
        return jpeg_bytes(self.shape_img) if self.shape_img is not None else None

    def gpu_mb(self):
        return None

    @staticmethod
    def tint(prompt):
        h = zlib.crc32(prompt.encode())
        return ((h >> 16) & 255, (h >> 8) & 255, h & 255)

    def set_reference(self, side, kind, img):
        self.refs[side][kind] = img

    def ref_colour(self, side, fallback):
        imgs = [im for im in self.refs[side].values() if im is not None]
        if not imgs:
            return fallback
        return tuple(int(v) for v in ImageStat.Stat(imgs[0].convert("RGB")).mean)

    def person(self, img, prompt, pose=None):
        time.sleep(0.05)
        kind = TUNE["shape"]
        self.shape_img = None if kind == "off" else (draw_openpose(pose or []) if kind == "pose" else
                                                     ImageOps.autocontrast(ImageOps.grayscale(img).filter(ImageFilter.GaussianBlur(4))).convert("RGB"))
        c = self.ref_colour("person", self.tint(prompt))
        g = ImageOps.colorize(ImageOps.grayscale(ImageOps.posterize(img, 3)), black=(20, 10, 40), white=c)
        return Image.blend(img, g, min(1.0, float(TUNE["change"])))

    def background(self, prompt, seed):
        time.sleep(0.3)
        init = self.refs["background"]["image"]
        if init is not None:
            img = ImageOps.fit(init.convert("RGB"), (WIDTH, HEIGHT)).filter(ImageFilter.GaussianBlur(3))
        else:
            rnd, c = random.Random(seed), self.ref_colour("background", self.tint(prompt))
            img = Image.new("RGB", (WIDTH, HEIGHT), c)
            d = ImageDraw.Draw(img)
            for _ in range(30):
                x, y, r = rnd.randrange(WIDTH), rnd.randrange(HEIGHT), rnd.randrange(10, 80)
                d.ellipse((x - r, y - r, x + r, y + r), fill=tuple(min(255, max(0, v + rnd.randrange(-60, 60))) for v in c))
            img = img.filter(ImageFilter.GaussianBlur(6))
        ImageDraw.Draw(img).text((12, HEIGHT - 24), "MOCK WORLD · " + prompt[:70], fill=(255, 255, 255))
        return img


gen = None
lock = asyncio.Lock()
frame_log = collections.deque(maxlen=60)          # (time, ms) of recent avatar frames, for the readout
world_ms = None


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


def run_person(jpeg, prompt, pose=None):
    t0 = time.perf_counter()
    gen.apply_loras(TUNE)
    img = Image.open(io.BytesIO(jpeg)).convert("RGB")
    if img.size != (WIDTH, HEIGHT):
        img = ImageOps.fit(img, (WIDTH, HEIGHT))
    out = gen.person(img, full_prompt(prompt), pose)
    ms = (time.perf_counter() - t0) * 1000
    frame_log.append((time.time(), ms))
    return jpeg_bytes(out), ms


def run_background(prompt, seed):
    global world_ms
    t0 = time.perf_counter()
    gen.apply_loras(TUNE)
    out = gen.background(full_prompt(prompt), seed)
    world_ms = (time.perf_counter() - t0) * 1000
    return jpeg_bytes(out), world_ms


# ---------- web ----------
@app.on_event("startup")
async def load():
    global gen
    if not MOCK:
        await asyncio.to_thread(download_loras)
    gen = await asyncio.to_thread(MockGenerator if MOCK else Generator)
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
            "filter": current_style().get("filter", "")}


# ---------- tuning ----------
def clean_tune(d):
    """Only known keys, with sane types and ranges."""
    out = {}
    rng = {"change": (0.1, 1.0), "world_steps": (1, 4), "lora_a_w": (0, 2), "lora_b_w": (0, 2),
           "ip_style": (0, 1.5), "guidance": (1, 4), "steady": (0, 0.85), "cn_strength": (0, 1.5)}
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
            if k == "shape" and v not in ("depth", "pose", "off"):
                continue
            if k == "style" and v not in load_styles():
                continue
        out[k] = v
    return out


def settings_view():
    now = time.time()
    recent = [(t, ms) for t, ms in frame_log if now - t < 3]
    fps = (len(recent) - 1) / (recent[-1][0] - recent[0][0]) if len(recent) > 2 and recent[-1][0] > recent[0][0] else 0
    mem = gen.gpu_mb() if gen else None
    return {
        "tune": TUNE, "defaults": TUNE_DEFAULTS, "look": look_version,
        "styles": [{"id": k, "name": v.get("name", k), "prompt": v.get("prompt", ""), "filter": v.get("filter", ""),
                    "lora": v.get("lora")} for k, v in load_styles().items()],
        "loras": [{"file": f, "trigger": trigger_words(f), "error": (gen.lora_errors.get(f) if gen else None)} for f in list_loras()],
        "readout": {
            "painter": "mock" if MOCK else PAINTER,
            "fps": round(fps, 1),
            "ms": round(sum(ms for _, ms in recent) / len(recent)) if recent else None,
            "world_ms": round(world_ms) if world_ms else None,
            "gpu_mb": mem[0] if mem else None, "gpu_total_mb": mem[1] if mem else None,
            "shape_ms": round(gen.shape_ms, 1) if gen and gen.shape_ms else None,
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
async def frame(request: Request, prompt: str = ""):
    """One camera frame in (JPEG), the person repainted out (JPEG). All tuning comes from /settings.
    (Older pages still send strength / steady / style in the address: they're ignored now.)"""
    jpeg = await request.body()
    prompt = prompt.strip() or "a person"
    pose = None
    try:                                                         # pose mode: the browser sends the joints along
        raw = request.headers.get("X-Pose")
        pose = [[float(v) for v in p[:3]] for p in json.loads(raw)][:33] if raw else None
    except (ValueError, TypeError):
        pose = None
    async with lock:
        out, ms = await asyncio.to_thread(run_person, jpeg, prompt, pose)
    return Response(out, media_type="image/jpeg", headers={"X-Gen-Ms": str(round(ms)), "X-Look": str(look_version), "Cache-Control": "no-store"})


@app.get("/background")
async def background(prompt: str = ""):
    """A fresh world for the prompt. A new random seed every time, so every draw is a new place."""
    prompt = prompt.strip() or "an empty landscape"
    async with lock:
        out, ms = await asyncio.to_thread(run_background, prompt, random.randrange(1 << 30))
    return Response(out, media_type="image/jpeg", headers={"X-Gen-Ms": str(round(ms)), "X-Look": str(look_version), "Cache-Control": "no-store"})


# the pages (index.html = the lab, game.html, panel.html, live.js, stages.js); mounted last so the routes above win
app.mount("/", StaticFiles(directory=os.path.join(HERE, "web"), html=True), name="web")


if __name__ == "__main__":
    import uvicorn
    print("loading..." + ("   (MOCK mode)" if MOCK else f"  painter '{PAINTER}' (first start downloads models and takes a while)"))
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
