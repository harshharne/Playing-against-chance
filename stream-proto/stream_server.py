"""
Live webcam -> diffusion, StreamDiffusion-style, for Apple Silicon (MPS).

Two separate generations:
  BACKGROUND  made once per Enter from its own prompt (a few fast steps, full-quality VAE).
  PERSON      the browser cuts the person out of the camera, places them on the generated
              background and sends that frame here; it gets one or two fast steps guided by
              the person prompt and goes straight back. The browser keeps only the person.

Reference images (each side has its own):
  STYLE  steers the look, through IP-Adapter (an "image prompt")
  IMAGE  person: also through IP-Adapter, mixed with the style
         background: becomes the starting picture, re-imagined by the prompt

Engines (set ENGINE=... when starting):
  sd15   (default) DreamShaper 8 + LCM-LoRA + IP-Adapter. References work.
  turbo  SD-Turbo, the earlier version. Faster, but only the background IMAGE reference works.

Speed tricks (the same ideas StreamDiffusion uses): few-step distilled models, a tiny VAE for
live frames, prompts and reference images encoded once, the same noise every frame, light
feeding each result back into the next frame, and only one frame in flight.

First time:     python download_models.py   (downloads everything once, ~5 GB)
Run:            python stream_server.py      then open http://localhost:8766
Without model:  MOCK=1 python stream_server.py  (fake effect, to test the page)
"""

import asyncio
import io
import os
import random
import time
import zlib

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageDraw, ImageFilter, ImageOps, ImageStat

# ---------- settings you may want to tweak ----------
PORT = 8766
WIDTH, HEIGHT = 640, 384          # output size; both must be multiples of 64
SEED = 7                          # noise used for the live person frames
ENGINE = os.environ.get("ENGINE", "sd15")
MOCK = os.environ.get("MOCK") == "1"

SD15_MODEL = os.environ.get("MODEL", "Lykon/dreamshaper-8")   # any SD 1.5 model on Hugging Face
LCM_LORA = "latent-consistency/lcm-lora-sdv1-5"
IP_ADAPTER = ("h94/IP-Adapter", "models", "ip-adapter-plus_sd15.safetensors")   # "plus" copies drawing style much better than the basic one
TURBO_MODEL = "stabilityai/sd-turbo"
TINY_VAE = "madebyollin/taesd"

PERSON_STEPS = 1                  # 1 = faster and smoother, 2 = cleaner but about half the fps (sd15 only)
# how strongly the reference images steer each side comes from the STYLE slider on the page
BG_IMAGE_KEEP = 0.35              # background IMAGE reference: how much of the picture survives (0.2–0.6)
# from the sliders on the page: CHANGE = how much the person is re-imagined,
# STEADY = how much each frame leans on the previous one (less flicker, more lag/ghosting)

HERE = os.path.dirname(os.path.abspath(__file__))
app = FastAPI()


def load_pipe(device="cpu", dtype=None):
    """Loads (and on first use downloads) every model this engine needs."""
    import torch
    from diffusers import AutoencoderTiny, LCMScheduler, StableDiffusionPipeline

    dtype = dtype or torch.float16

    def get(repo):
        try:
            return StableDiffusionPipeline.from_pretrained(repo, torch_dtype=dtype, variant="fp16", safety_checker=None)
        except Exception:
            return StableDiffusionPipeline.from_pretrained(repo, torch_dtype=dtype, safety_checker=None)

    if ENGINE == "turbo":
        pipe = get(TURBO_MODEL)
    else:
        pipe = get(SD15_MODEL)
        pipe.scheduler = LCMScheduler.from_config(pipe.scheduler.config)
        print("[gen] adding LCM-LoRA (fast steps) ...")
        pipe.load_lora_weights(LCM_LORA)
        pipe.fuse_lora()
        print("[gen] adding IP-Adapter (reference images) ...")
        pipe.load_ip_adapter(IP_ADAPTER[0], subfolder=IP_ADAPTER[1], weight_name=IP_ADAPTER[2])
    tiny = AutoencoderTiny.from_pretrained(TINY_VAE, torch_dtype=dtype)
    pipe.to(device)
    tiny.to(device)
    pipe.set_progress_bar_config(disable=True)
    return pipe, tiny


# ---------- the generator ----------
class Generator:
    def __init__(self):
        import numpy as np
        import torch

        self.np, self.torch = np, torch
        self.device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
        self.dtype = torch.float16 if self.device != "cpu" else torch.float32
        print(f"[gen] loading engine '{ENGINE}' on {self.device} ...")
        pipe, self.tiny_vae = load_pipe(self.device, self.dtype)
        self.pipe, self.unet, self.full_vae = pipe, pipe.unet, pipe.vae
        self.prediction = pipe.scheduler.config.get("prediction_type", "epsilon")
        self.alphas = pipe.scheduler.alphas_cumprod.to(self.device, torch.float32)
        self.has_ip = ENGINE == "sd15"
        self.embeds = {}                                         # prompt -> encoded prompt
        self.noises = {}                                         # (step, shape) -> fixed noise
        self.prev, self.prev_key = None, None
        self.refs = {s: {"style": None, "image": None} for s in ("person", "background")}
        self.ip = {"person": None, "background": None}           # side -> combined image embedding
        self.ip_scale = None
        self.style = {"person": 0.8, "background": 0.8}           # set live by the STYLE slider
        if self.has_ip:
            self.ip_plus = "plus" in IP_ADAPTER[2]
            self.ip_zero = self.encode_images([Image.new("RGB", (224, 224), (128, 128, 128))]) * 0
        print(f"[gen] ready · prediction={self.prediction} · references={'yes' if self.has_ip else 'background image only'}")

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
        if not self.has_ip:
            return
        imgs = [im for k, im in self.refs[side].items() if im is not None and not (side == "background" and k == "image")]
        if not imgs:
            self.ip[side] = None
            return
        self.ip[side] = self.encode_images(imgs)

    def encode_images(self, imgs):
        """Reference images -> one IP-Adapter embedding (several images are mixed together)."""
        with self.torch.no_grad():
            px = self.pipe.feature_extractor(images=imgs, return_tensors="pt").pixel_values.to(self.device, self.dtype)
            if self.ip_plus:   # plus reads the encoder's detailed patch features, which carry the style
                e = self.pipe.image_encoder(px, output_hidden_states=True).hidden_states[-2]
            else:
                e = self.pipe.image_encoder(px).image_embeds
            return e.mean(0, keepdim=True)[:, None]                   # (1, 1, ...)

    def unet_kwargs(self, side):
        if not self.has_ip:
            return {}
        emb = self.ip[side]
        scale = self.style[side] if emb is not None else 0.0
        if scale != self.ip_scale:
            self.pipe.set_ip_adapter_scale(scale)
            self.ip_scale = scale
        return {"added_cond_kwargs": {"image_embeds": [emb if emb is not None else self.ip_zero]}}

    # --- denoising ---
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

    def denoise(self, lat, timesteps, prompt, side, seed=None):
        """Few-step sampling: noise up to t, predict the clean picture, repeat at a lower t."""
        torch = self.torch
        x0 = lat if lat is not None else torch.zeros((1, 4, HEIGHT // 8, WIDTH // 8), device=self.device, dtype=self.dtype)
        kw = self.unet_kwargs(side)
        text = self.embed(prompt)
        for i, t in enumerate(timesteps):
            a = self.alphas[t]
            sa, s1a = a.sqrt().to(self.dtype), (1 - a).sqrt().to(self.dtype)
            noisy = sa * x0 + s1a * self.noise(i, x0.shape, seed)
            out = self.unet(noisy, torch.tensor([t], device=self.device), encoder_hidden_states=text, **kw).sample
            x0 = sa * noisy - s1a * out if self.prediction == "v_prediction" else (noisy - s1a * out) / sa
        return x0

    def person(self, img, prompt, strength, steady):
        t1 = int(max(1, min(999, round(strength * 1000) - 1)))
        ts = [t1] if PERSON_STEPS == 1 else [t1, max(1, int(t1 * 0.4))]
        with self.torch.no_grad():
            lat = self.tiny_vae.encode(self.to_tensor(img)).latents
            same = self.prev is not None and self.prev_key == prompt and self.prev.shape == lat.shape
            if same and steady > 0:
                # feedback: the new frame starts partly from the last result, so the look carries over
                lat = (1 - steady) * lat + steady * self.prev
            x0 = self.denoise(lat, ts, prompt, "person")
            if same and steady > 0:
                # and the result is blended a little with the last one, so it doesn't jump
                x0 = (steady * 0.5) * self.prev + (1 - steady * 0.5) * x0
            self.prev, self.prev_key = x0, prompt
            y = self.tiny_vae.decode(x0).sample
        return self.to_image(y)

    def background(self, prompt, seed):
        init = self.refs["background"]["image"]
        sf = self.full_vae.config.scaling_factor
        with self.torch.no_grad():
            if init is not None:                                 # start from the reference picture
                img = ImageOps.fit(init, (WIDTH, HEIGHT))
                lat = self.full_vae.encode(self.to_tensor(img)).latent_dist.mean * sf
                t0 = int((1 - BG_IMAGE_KEEP) * 1000) - 1
                ts = [t0] if ENGINE == "turbo" else [t0, int(t0 * 0.6), int(t0 * 0.3)]
            else:                                                # start from pure noise
                lat = None
                ts = [999] if ENGINE == "turbo" else [999, 749, 499, 249]
            x0 = self.denoise(lat, ts, prompt, "background", seed=seed)
            y = self.full_vae.decode(x0 / sf).sample
            if self.torch.isnan(y).any():                        # fp16 trouble: fall back to the tiny VAE
                y = self.tiny_vae.decode(x0).sample
        return self.to_image(y)

    def to_tensor(self, img):
        x = self.torch.from_numpy(self.np.asarray(img.convert("RGB"), dtype="float32")).permute(2, 0, 1)[None]
        return (x / 127.5 - 1).to(self.device, self.dtype)

    def to_image(self, y):
        y = ((y.clamp(-1, 1)[0].permute(1, 2, 0).float() + 1) * 127.5).round().byte().cpu().numpy()
        return Image.fromarray(y)


class MockGenerator:
    """No model: fake effects so the page and the loop can be tested."""
    has_ip = True

    def __init__(self):
        self.refs = {s: {"style": None, "image": None} for s in ("person", "background")}

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

    def person(self, img, prompt, strength, steady):
        time.sleep(0.1)
        c = self.ref_colour("person", self.tint(prompt))
        g = ImageOps.colorize(ImageOps.grayscale(ImageOps.posterize(img, 3)), black=(20, 10, 40), white=c)
        return Image.blend(img, g, strength)

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
        ImageDraw.Draw(img).text((12, HEIGHT - 24), "MOCK BACKGROUND · " + prompt[:50], fill=(255, 255, 255))
        return img


gen = None
lock = asyncio.Lock()


def jpeg_bytes(img):
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    return buf.getvalue()


def run_person(jpeg, prompt, strength, steady=0.4, style=None):
    if style is not None and hasattr(gen, "style"):
        gen.style["person"] = style
    t0 = time.perf_counter()
    img = Image.open(io.BytesIO(jpeg)).convert("RGB")
    if img.size != (WIDTH, HEIGHT):
        img = ImageOps.fit(img, (WIDTH, HEIGHT))
    out = gen.person(img, prompt, strength, steady)
    return jpeg_bytes(out), (time.perf_counter() - t0) * 1000


def run_background(prompt, seed, style=None):
    if style is not None and hasattr(gen, "style"):
        gen.style["background"] = style
    t0 = time.perf_counter()
    out = gen.background(prompt, seed)
    return jpeg_bytes(out), (time.perf_counter() - t0) * 1000


# ---------- web ----------
@app.on_event("startup")
async def load():
    global gen
    gen = await asyncio.to_thread(MockGenerator if MOCK else Generator)
    if not MOCK:   # warm up so the first real frames aren't slow
        await asyncio.to_thread(run_background, "warm up", 0)
        await asyncio.to_thread(run_person, jpeg_bytes(Image.new("RGB", (WIDTH, HEIGHT), (128, 128, 128))), "warm up", 0.5)
    print(f"open http://localhost:{PORT}" + ("   (MOCK mode)" if MOCK else ""))


@app.get("/")
async def index():
    return FileResponse(os.path.join(HERE, "web", "index.html"))


@app.get("/config")
async def config():
    return {"width": WIDTH, "height": HEIGHT, "mock": MOCK, "engine": "mock" if MOCK else ENGINE, "references": bool(gen and gen.has_ip)}


@app.post("/reference")
async def reference(request: Request, side: str, kind: str):
    """Set (image in the body) or clear (empty body) one reference image."""
    if side not in ("person", "background") or kind not in ("style", "image"):
        return Response(status_code=400)
    body = await request.body()
    img = Image.open(io.BytesIO(body)).convert("RGB") if body else None
    async with lock:
        await asyncio.to_thread(gen.set_reference, side, kind, img)
    works = gen.has_ip or (side == "background" and kind == "image")
    return {"ok": True, "works": works}


@app.post("/frame")
async def frame(request: Request, prompt: str = "", strength: float = 0.6, steady: float = 0.4, style: float = 0.8):
    """One camera frame in (JPEG), the person re-imagined out (JPEG)."""
    jpeg = await request.body()
    prompt = prompt.strip() or "a person"
    strength = max(0.1, min(0.95, strength))
    steady = max(0.0, min(0.85, steady))
    async with lock:
        out, ms = await asyncio.to_thread(run_person, jpeg, prompt, strength, steady, max(0.0, min(1.5, style)))
    return Response(out, media_type="image/jpeg", headers={"X-Gen-Ms": str(round(ms)), "Cache-Control": "no-store"})


@app.get("/background")
async def background(prompt: str = "", style: float = 0.8):
    """A fresh background for the prompt. A new random seed every time, so every Enter is a new place."""
    prompt = prompt.strip() or "an empty landscape"
    async with lock:
        out, ms = await asyncio.to_thread(run_background, prompt, random.randrange(1 << 30), max(0.0, min(1.5, style)))
    return Response(out, media_type="image/jpeg", headers={"X-Gen-Ms": str(round(ms)), "Cache-Control": "no-store"})


if __name__ == "__main__":
    import uvicorn
    print("loading..." + ("   (MOCK mode)" if MOCK else f"  engine '{ENGINE}' (first start takes a while)"))
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
