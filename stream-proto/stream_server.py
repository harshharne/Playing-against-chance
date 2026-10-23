"""
Live webcam -> diffusion, StreamDiffusion-style, for Apple Silicon (MPS).

The browser sends webcam frames to the server, one at a time, as plain web requests. Each frame gets ONE SD-Turbo
denoising step guided by the current prompt, and the result is sent straight back.
The tricks that make it fast and steady (the same ideas StreamDiffusion uses):
  - SD-Turbo: a model trained to make an image in a single step
  - TAESD: a tiny VAE, much faster than the normal one for encoding/decoding
  - the prompt is encoded once, only when it changes
  - the same noise every frame, so the image doesn't boil
  - optional blending with the previous frame for extra calm
  - only one frame in flight: stale frames are never processed

Run:            python stream_server.py         then open http://localhost:8766
Without model:  MOCK=1 python stream_server.py  (fake effect, to test the page)
"""

import asyncio
import io
import os
import time
import zlib

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageDraw, ImageOps

# ---------- settings you may want to tweak ----------
PORT = 8766
WIDTH, HEIGHT = 640, 384      # output size; both must be multiples of 64
STRENGTH = 0.5                # 0.25 = stays close to the camera, 0.75 = more invented. SD-Turbo likes 0.25 / 0.5 / 0.75
SMOOTH = 0.25                 # 0 = no blending with the previous frame, 0.6 = very calm but ghosty
SEED = 7                      # change for a different "look" of the same prompt
MODEL = "stabilityai/sd-turbo"
TINY_VAE = "madebyollin/taesd"
MOCK = os.environ.get("MOCK") == "1"

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
        pipe.vae = AutoencoderTiny.from_pretrained(TINY_VAE, torch_dtype=self.dtype)
        pipe.to(self.device)
        pipe.set_progress_bar_config(disable=True)
        self.pipe, self.unet, self.vae = pipe, pipe.unet, pipe.vae
        self.prediction = pipe.scheduler.config.get("prediction_type", "epsilon")
        self.alphas = pipe.scheduler.alphas_cumprod.to(self.device, torch.float32)
        self.sf = getattr(self.vae.config, "scaling_factor", 1.0) or 1.0
        self.prompt, self.embeds = None, None
        self.noise, self.prev = None, None
        self.set_strength(STRENGTH)
        print(f"[gen] ready · prediction={self.prediction}")

    def set_strength(self, s):
        self.t = int(max(1, min(999, round(s * 1000) - 1)))      # 0.5 -> timestep 499
        a = self.alphas[self.t]
        self.sa, self.s1a = a.sqrt().to(self.dtype), (1 - a).sqrt().to(self.dtype)
        self.timestep = self.torch.tensor([self.t], device=self.device)

    def set_prompt(self, prompt):
        if prompt == self.prompt:
            return
        with self.torch.no_grad():
            embeds, _ = self.pipe.encode_prompt(prompt, self.device, 1, False)
        self.prompt, self.embeds, self.prev = prompt, embeds, None

    def __call__(self, img: Image.Image) -> Image.Image:
        torch = self.torch
        with torch.no_grad():
            x = torch.from_numpy(self.np.asarray(img, dtype="float32")).permute(2, 0, 1)[None]
            x = (x / 127.5 - 1).to(self.device, self.dtype)
            lat = self.vae.encode(x).latents * self.sf
            if self.noise is None or self.noise.shape != lat.shape:
                g = torch.Generator("cpu").manual_seed(SEED)
                self.noise = torch.randn(lat.shape, generator=g).to(self.device, self.dtype)
                self.prev = None
            noisy = self.sa * lat + self.s1a * self.noise
            out = self.unet(noisy, self.timestep, encoder_hidden_states=self.embeds).sample
            if self.prediction == "v_prediction":
                x0 = self.sa * noisy - self.s1a * out
            else:
                x0 = (noisy - self.s1a * out) / self.sa
            if self.prev is not None and SMOOTH > 0:
                x0 = SMOOTH * self.prev + (1 - SMOOTH) * x0
            self.prev = x0
            y = self.vae.decode(x0 / self.sf).sample.clamp(-1, 1)
            y = ((y[0].permute(1, 2, 0).float() + 1) * 127.5).round().byte().cpu().numpy()
        return Image.fromarray(y)


class MockGenerator:
    """No model: tints and posterizes the frame so the page and the loop can be tested."""
    def set_prompt(self, prompt):
        self.prompt = prompt
        h = zlib.crc32(prompt.encode())
        self.tint = ((h >> 16) & 255, (h >> 8) & 255, h & 255)

    def __call__(self, img):
        time.sleep(0.12)
        g = ImageOps.posterize(ImageOps.grayscale(img).convert("RGB"), 3)
        out = ImageOps.colorize(ImageOps.grayscale(g), black=(20, 10, 40), white=self.tint)
        ImageDraw.Draw(out).text((12, 12), "MOCK · " + self.prompt[:60], fill=(255, 255, 255))
        return out


gen = None
lock = asyncio.Lock()


def run_frame(jpeg: bytes, prompt: str) -> tuple[bytes, float]:
    t0 = time.perf_counter()
    img = Image.open(io.BytesIO(jpeg)).convert("RGB")
    if img.size != (WIDTH, HEIGHT):
        img = ImageOps.fit(img, (WIDTH, HEIGHT))
    gen.set_prompt(prompt)
    out = gen(img)
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=85)
    return buf.getvalue(), (time.perf_counter() - t0) * 1000


# ---------- web ----------
@app.on_event("startup")
async def load():
    global gen
    gen = await asyncio.to_thread(MockGenerator if MOCK else Generator)
    if not MOCK:   # warm up so the first real frame isn't slow
        await asyncio.to_thread(run_frame, _blank_jpeg(), "warm up")


def _blank_jpeg():
    buf = io.BytesIO()
    Image.new("RGB", (WIDTH, HEIGHT), (128, 128, 128)).save(buf, "JPEG")
    return buf.getvalue()


@app.get("/")
async def index():
    return FileResponse(os.path.join(HERE, "web", "index.html"))


@app.get("/config")
async def config():
    return {"width": WIDTH, "height": HEIGHT, "mock": MOCK}


@app.post("/frame")
async def frame(request: Request, prompt: str = ""):
    """One camera frame in (JPEG), one generated frame out (JPEG)."""
    jpeg = await request.body()
    prompt = prompt.strip() or "a person"
    async with lock:
        out, ms = await asyncio.to_thread(run_frame, jpeg, prompt)
    return Response(out, media_type="image/jpeg", headers={"X-Gen-Ms": str(round(ms)), "Cache-Control": "no-store"})


if __name__ == "__main__":
    import uvicorn
    print(f"open http://localhost:{PORT}" + ("   (MOCK mode)" if MOCK else ""))
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
