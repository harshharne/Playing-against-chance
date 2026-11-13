"""
Train a STYLE LoRA for the SDXL painters, on the GPU machine (chance-rtx):

    python train_style_lora.py ~/style --name mylook            (about 20-30 minutes, plus a ~7 GB download the first time)

~/style = 20-40 images in the one look you want (jpg / png / webp). Optional: a .txt beside an image with what's IN it
("a woman reading by a window"). Without one, each image is described automatically (BLIP), so the LoRA learns the
LOOK and not the things in your pictures. Writes, into loras/:
    mylook.safetensors        the LoRA after all the steps
    mylook-early.safetensors  the same at 60 % of the steps (in case the full one copies your pictures too closely)
    mylook.txt, mylook-early.txt   the trigger words, added to every prompt when the LoRA is on
Then on /panel pick it as LORA A and set its weight (start at 0.8). It works on both SDXL painters: the worlds and the
portraits (DreamShaper XL Lightning) and the live avatar (SDXL-Turbo). Trained on SDXL base 1.0.

Options: --steps 1200  --rank 16  --lr 1e-4  --trigger "mylook painting"  --no-captions (same caption for every image)
"""
import argparse
import math
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "stabilityai/stable-diffusion-xl-base-1.0"
VAE = "madebyollin/sdxl-vae-fp16-fix"
CAPTIONER = "Salesforce/blip-image-captioning-base"
BUCKETS = [(1024, 1024), (1152, 896), (896, 1152), (1216, 832), (832, 1216), (1344, 768), (768, 1344)]   # (w, h)
EXTS = (".jpg", ".jpeg", ".png", ".webp")


def find_images(folder):
    files = sorted(os.path.join(folder, f) for f in os.listdir(folder) if f.lower().endswith(EXTS) and not f.startswith("."))
    if not files:
        sys.exit(f"no images in {folder} (jpg, png or webp)")
    return files


def fit_bucket(img):
    """Resize to cover the nearest SDXL shape, then crop the middle."""
    from PIL import ImageOps
    w, h = img.size
    bw, bh = min(BUCKETS, key=lambda b: abs(math.log((b[0] / b[1]) / (w / h))))
    return ImageOps.fit(img, (bw, bh), method=3)


def captions_for(files, use_blip, device):
    caps = {}
    need = []
    for f in files:
        txt = os.path.splitext(f)[0] + ".txt"
        if os.path.exists(txt):
            caps[f] = open(txt, encoding="utf-8").read().strip()
        else:
            need.append(f)
    if need and use_blip:
        print(f"describing {len(need)} images with BLIP ...")
        import torch
        from PIL import Image
        from transformers import BlipForConditionalGeneration, BlipProcessor
        proc = BlipProcessor.from_pretrained(CAPTIONER)
        model = BlipForConditionalGeneration.from_pretrained(CAPTIONER, torch_dtype=torch.float16).to(device)
        for f in need:
            inp = proc(images=Image.open(f).convert("RGB"), return_tensors="pt").to(device, torch.float16)
            with torch.no_grad():
                out = model.generate(**inp, max_new_tokens=30)
            caps[f] = proc.decode(out[0], skip_special_tokens=True).strip()
        del model
        torch.cuda.empty_cache()
    for f in need:
        caps.setdefault(f, "")
    return caps


def load_base(device):
    """SDXL base: (unet, vae, encode(prompt) -> (embeds, pooled), scheduler)."""
    import torch
    from diffusers import AutoencoderKL, DDPMScheduler, StableDiffusionXLPipeline
    vae = AutoencoderKL.from_pretrained(VAE, torch_dtype=torch.float16)
    try:
        pipe = StableDiffusionXLPipeline.from_pretrained(BASE, torch_dtype=torch.float16, variant="fp16", vae=vae)
    except Exception:
        pipe = StableDiffusionXLPipeline.from_pretrained(BASE, torch_dtype=torch.float16, vae=vae)
    pipe.to(device)

    def encode(prompt):
        with torch.no_grad():
            pe, _, pooled, _ = pipe.encode_prompt(prompt=prompt, device=device, num_images_per_prompt=1, do_classifier_free_guidance=False)
        return pe, pooled

    sched = DDPMScheduler.from_pretrained(BASE, subfolder="scheduler")
    return pipe, pipe.unet, pipe.vae, encode, sched


def main(argv=None, loader=load_base):
    ap = argparse.ArgumentParser(description="Train a style LoRA for the SDXL painters.")
    ap.add_argument("folder")
    ap.add_argument("--name", required=True, help="the LoRA's file name in loras/ (letters, digits, - and _)")
    ap.add_argument("--trigger", default="", help='words that call the style (default: "<name> painting")')
    ap.add_argument("--steps", type=int, default=1200)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--accum", type=int, default=2, help="images per step")
    ap.add_argument("--no-captions", action="store_true", help="don't describe the images (every caption = the trigger)")
    ap.add_argument("--out", default=os.path.join(HERE, "loras"))
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args(argv)

    import numpy as np
    import torch
    import torch.nn.functional as F
    from PIL import Image
    from peft import LoraConfig
    from peft.utils import get_peft_model_state_dict
    from diffusers import StableDiffusionXLPipeline
    from diffusers.utils import convert_state_dict_to_diffusers

    name = "".join(c if c.isalnum() or c in "-_" else "_" for c in a.name)
    trigger = a.trigger.strip() or f"{name} painting"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    random.seed(a.seed)
    torch.manual_seed(a.seed)
    os.makedirs(a.out, exist_ok=True)
    t_start = time.time()

    files = find_images(os.path.expanduser(a.folder))
    print(f"{len(files)} images · trigger \"{trigger}\" · {a.steps} steps · rank {a.rank}")
    caps = captions_for(files, not a.no_captions, device)

    print("loading SDXL base (the first time this downloads ~7 GB) ...")
    pipe, unet, vae, encode, sched = loader(device)

    # everything the training needs, worked out once: the pictures as latents (and mirrored), the captions as embeddings
    items = []
    sf = vae.config.scaling_factor
    for f in files:
        img = fit_bucket(Image.open(f).convert("RGB"))
        w, h = img.size
        prompt = f"{trigger}, {caps[f]}" if caps[f] else trigger
        pe, pooled = encode(prompt)
        tid = torch.tensor([[h, w, 0, 0, h, w]], device=device, dtype=torch.float32)
        for flip in (False, True):
            im = img.transpose(Image.FLIP_LEFT_RIGHT) if flip else img
            x = torch.from_numpy(np.asarray(im).copy()).permute(2, 0, 1)[None].to(device, vae.dtype) / 127.5 - 1
            with torch.no_grad():
                lat = vae.encode(x).latent_dist.sample() * sf
            items.append({"lat": lat, "pe": pe, "pooled": pooled, "tid": tid})
        print(f"  {os.path.basename(f)} {w}x{h} · {prompt[:90]}")
    # the text encoders and the VAE aren't needed while training
    for part in ("text_encoder", "text_encoder_2", "vae"):
        if getattr(pipe, part, None) is not None:
            getattr(pipe, part).to("cpu")
    torch.cuda.empty_cache()

    dtype = torch.bfloat16 if device == "cuda" and torch.cuda.is_bf16_supported() else torch.float32
    unet.to(device, dtype)
    unet.requires_grad_(False)
    unet.add_adapter(LoraConfig(r=a.rank, lora_alpha=a.rank, init_lora_weights="gaussian",
                                target_modules=["to_k", "to_q", "to_v", "to_out.0"]))
    params = [p for p in unet.parameters() if p.requires_grad]
    for p in params:
        p.data = p.data.float()
    unet.train()
    print(f"training {sum(p.numel() for p in params) / 1e6:.1f} M numbers in {dtype} ...")

    opt = torch.optim.AdamW(params, lr=a.lr, weight_decay=1e-2)
    warm = min(50, a.steps // 10)
    lr_at = lambda s: a.lr * (s + 1) / warm if s < warm else a.lr * 0.5 * (1 + math.cos(math.pi * (s - warm) / max(1, a.steps - warm)))
    ac = sched.alphas_cumprod.to(device)
    pred_type = sched.config.get("prediction_type", "epsilon")

    def save(tag):
        state = {k: v.to(torch.float16) for k, v in get_peft_model_state_dict(unet).items()}
        fname = f"{name}{tag}.safetensors"
        StableDiffusionXLPipeline.save_lora_weights(a.out, unet_lora_layers=convert_state_dict_to_diffusers(state),
                                                    weight_name=fname, safe_serialization=True)
        with open(os.path.join(a.out, f"{name}{tag}.txt"), "w", encoding="utf-8") as fh:
            fh.write(trigger)
        print(f"  saved loras/{fname}")

    order, losses, t0 = [], [], time.time()
    for step in range(a.steps):
        for g in opt.param_groups:
            g["lr"] = lr_at(step)
        for _ in range(a.accum):
            if not order:
                order = list(range(len(items)))
                random.shuffle(order)
            it = items[order.pop()]
            lat = it["lat"]
            noise = torch.randn_like(lat) + 0.05 * torch.randn(lat.shape[0], lat.shape[1], 1, 1, device=device, dtype=lat.dtype)
            t = torch.randint(0, sched.config.num_train_timesteps, (1,), device=device)
            noisy = sched.add_noise(lat, noise, t)
            with torch.autocast(device_type="cuda" if device == "cuda" else "cpu", dtype=dtype, enabled=dtype != torch.float32):
                pred = unet(noisy.to(dtype), t, encoder_hidden_states=it["pe"].to(dtype),
                            added_cond_kwargs={"text_embeds": it["pooled"].to(dtype), "time_ids": it["tid"].to(dtype)}).sample
            target = sched.get_velocity(lat, noise, t) if pred_type == "v_prediction" else noise
            snr = ac[t] / (1 - ac[t])
            weight = (torch.clamp(snr, max=5.0) / snr).float()                 # min-SNR: steadier learning
            loss = (F.mse_loss(pred.float(), target.float(), reduction="none").mean(dim=(1, 2, 3)) * weight).mean() / a.accum
            loss.backward()
            losses.append(loss.item() * a.accum)
        torch.nn.utils.clip_grad_norm_(params, 1.0)
        opt.step()
        opt.zero_grad(set_to_none=True)
        if (step + 1) % 50 == 0 or step == 0:
            el = time.time() - t0
            left = el / (step + 1) * (a.steps - step - 1)
            print(f"step {step + 1}/{a.steps} · loss {sum(losses[-100:]) / len(losses[-100:]):.4f} · "
                  f"{el / (step + 1):.2f} s a step · about {left / 60:.0f} min left", flush=True)
        if step + 1 == int(a.steps * 0.6):
            save("-early")
    save("")
    print(f"done in {(time.time() - t_start) / 60:.1f} min. On /panel: LORA A = {name} (or {name}-early), weight 0.8.")


if __name__ == "__main__":
    main()
