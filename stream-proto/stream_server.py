"""
Live webcam -> diffusion, StreamDiffusion-style, for Apple Silicon (MPS).

Two separate generations:
  BACKGROUND  made once per Enter from its own prompt (SD-Turbo, one step, full-quality VAE).
  PERSON      the browser cuts the person out of the camera, places them on the generated
              background and sends that frame here; it gets ONE SD-Turbo step guided by the
              person prompt and goes straight back. The browser then keeps only the person.

Speed tricks (the same ideas StreamDiffusion uses):
  - SD-Turbo: trained to make an image in a single step
  - TAESD: a tiny VAE for the live frames, much faster than the normal one
  - prompts are encoded once and cached
  - the same noise every frame, so the image doesn't boil
  - light blending with the previous frame
  - only one frame in flight: stale frames are never processed

Run:            python stream_server.py         then open http://localhost:8766
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
from PIL import Image, ImageDraw, ImageFilter, ImageOps

# ---------- settings you may want to tweak ----------
PORT = 8766
WIDTH, HEIGHT = 640, 384      # output size; both must be multiples of 64
SMOOTH = 0.2                  # 0 = no blending with the previous frame, 0.6 = very calm but ghosty
SEED = 7                      # noise used for the live person frames
MODEL = "stabilityai/sd-turbo"
TINY_VAE = "madebyollin/taesd"
MOCK = os.environ.get("MOCK") == "1"
# the strength of the person change comes from the slider on the page (0.25 = still you, 0.75 = mostly invented)

HERE = os.path.dirname(os.path.abspath(__file__))
app = FastAPI()


# ---------- the generator ----------
class Generator:
    def __init__(self):
        import numpy as np
        import torch
        from diffusers import AutoencoderTiny, StableDiffusionPipeline

        self.np, self.torch = np, torch
        self.device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
        self.dtype = torch.float16 if self.device != "cpu" else torch.float32
        print(f"[gen] loading {MODEL} on {self.device} ...")
        pipe = StableDiffusionPipeline.from_pretrained(MODEL, torch_dtype=self.dtype, safety_checker=None)
        self.full_vae = pipe.vae                                     # nicer, slower: for the background
        self.tiny_vae = AutoencoderTiny.from_pretrained(TINY_VAE, torch_dtype=self.dtype)
        pipe.to(self.device); self.tiny_vae.to(self.device)
        pipe.set_progress_bar_config(disable=True)
        self.pipe, self.unet = pipe, pipe.unet
        self.prediction = pipe.scheduler.config.get("prediction_type", "epsilon")
        self.alphas = pipe.scheduler.alphas_cumprod.to(self.device, torch.float32)
        self.embeds = {}                                             # prompt -> encoded prompt
        self.noise, self.prev, self.prev_key = None, None, None
        print(f"[gen] ready · prediction={self.prediction}")

    def embed(self, prompt):
        if prompt not in self.embeds:
            if len(self.embeds) > 32:
                self.embeds.clear()
            with self.torch.no_grad():
                self.embeds[prompt], _ = self.pipe.encode_prompt(prompt, self.device, 1, False)
        return self.embeds[prompt]

    def step(self, noisy, t, prompt):
        """One denoising step: from a noisy latent at timestep t straight to a clean latent."""
        a = self.alphas[t]
        sa, s1a = a.sqrt().to(self.dtype), (1 - a).sqrt().to(self.dtype)
        out = self.unet(noisy, self.torch.tensor([t], device=self.device), encoder_hidden_states=self.embed(prompt)).sample
        if self.prediction == "v_prediction":
            return sa * noisy - s1a * out
        return (noisy - s1a * out) / sa

    def person(self, img: Image.Image, prompt: str, strength: float) -> Image.Image:
        torch = self.torch
        t = int(max(1, min(999, round(strength * 1000) - 1)))      # 0.5 -> timestep 499
        a = self.alphas[t]
        with torch.no_grad():
            x = torch.from_numpy(self.np.asarray(img, dtype="float32")).permute(2, 0, 1)[None]
            x = (x / 127.5 - 1).to(self.device, self.dtype)
            lat = self.tiny_vae.encode(x).latents
            if self.noise is None or self.noise.shape != lat.shape:
                g = torch.Generator("cpu").manual_seed(SEED)
                self.noise = torch.randn(lat.shape, generator=g).to(self.device, self.dtype)
            noisy = a.sqrt().to(self.dtype) * lat + (1 - a).sqrt().to(self.dtype) * self.noise
            x0 = self.step(noisy, t, prompt)
            key = (prompt, t)
            if self.prev is not None and self.prev_key == key and SMOOTH > 0:
                x0 = SMOOTH * self.prev + (1 - SMOOTH) * x0
            self.prev, self.prev_key = x0, key
            y = self.tiny_vae.decode(x0).sample
        return self.to_image(y)

    def background(self, prompt: str, seed: int) -> Image.Image:
        torch = self.torch
        with torch.no_grad():
            g = torch.Generator("cpu").manual_seed(seed)
            noise = torch.randn((1, 4, HEIGHT // 8, WIDTH // 8), generator=g).to(self.device, self.dtype)
            x0 = self.step(noise, 999, prompt)
            y = self.full_vae.decode(x0 / self.full_vae.config.scaling_factor).sample
            if torch.isnan(y).any():                                 # fp16 trouble: fall back to the tiny VAE
                y = self.tiny_vae.decode(x0).sample
        return self.to_image(y)

    def to_image(self, y):
        y = ((y.clamp(-1, 1)[0].permute(1, 2, 0).float() + 1) * 127.5).round().byte().cpu().numpy()
        return Image.fromarray(y)


class MockGenerator:
    """No model: fake effects so the page and the loop can be tested."""
    @staticmethod
    def tint(prompt):
        h = zlib.crc32(prompt.encode())
        return ((h >> 16) & 255, (h >> 8) & 255, h & 255)

    def person(self, img, prompt, strength):
        time.sleep(0.1)
        g = ImageOps.posterize(img, 3)
        out = Image.blend(img, ImageOps.colorize(ImageOps.grayscale(g), black=(20, 10, 40), white=self.tint(prompt)), strength)
        return out

    def background(self, prompt, seed):
        time.sleep(0.3)
        rnd = random.Random(seed)
        c = self.tint(prompt)
        img = Image.new("RGB", (WIDTH, HEIGHT), c)
        d = ImageDraw.Draw(img)
        for _ in range(30):
            x, y, r = rnd.randrange(WIDTH), rnd.randrange(HEIGHT), rnd.randrange(10, 80)
            d.ellipse((x - r, y - r, x + r, y + r), fill=tuple(min(255, v + rnd.randrange(-60, 60)) for v in c))
        img = img.filter(ImageFilter.GaussianBlur(6))
        ImageDraw.Draw(img).text((12, HEIGHT - 24), "MOCK BACKGROUND · " + prompt[:50], fill=(255, 255, 255))
        return img


gen = None
lock = asyncio.Lock()


def jpeg_bytes(img):
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    return buf.getvalue()


def run_person(jpeg: bytes, prompt: str, strength: float):
    t0 = time.perf_counter()
    img = Image.open(io.BytesIO(jpeg)).convert("RGB")
    if img.size != (WIDTH, HEIGHT):
        img = ImageOps.fit(img, (WIDTH, HEIGHT))
    out = gen.person(img, prompt, strength)
    return jpeg_bytes(out), (time.perf_counter() - t0) * 1000


def run_background(prompt: str, seed: int):
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
    return {"width": WIDTH, "height": HEIGHT, "mock": MOCK}


@app.post("/frame")
async def frame(request: Request, prompt: str = "", strength: float = 0.6):
    """One camera frame in (JPEG), the person re-imagined out (JPEG)."""
    jpeg = await request.body()
    prompt = prompt.strip() or "a person"
    strength = max(0.1, min(0.95, strength))
    async with lock:
        out, ms = await asyncio.to_thread(run_person, jpeg, prompt, strength)
    return Response(out, media_type="image/jpeg", headers={"X-Gen-Ms": str(round(ms)), "Cache-Control": "no-store"})


@app.get("/background")
async def background(prompt: str = ""):
    """A fresh background for the prompt. A new random seed every time, so every Enter is a new place."""
    prompt = prompt.strip() or "an empty landscape"
    async with lock:
        out, ms = await asyncio.to_thread(run_background, prompt, random.randrange(1 << 30))
    return Response(out, media_type="image/jpeg", headers={"X-Gen-Ms": str(round(ms)), "Cache-Control": "no-store"})


if __name__ == "__main__":
    import uvicorn
    print("loading..." + ("   (MOCK mode)" if MOCK else "  (first start takes a while)"))
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
