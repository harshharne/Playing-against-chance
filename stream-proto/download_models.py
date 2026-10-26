"""
Downloads every model the server needs, once. Run it inside the venv, on the machine that runs the server:
    python download_models.py

Everything is saved in ~/.cache/huggingface (LoRAs are copied into loras/), so the server finds it next time.
For the default painter (PAINTER=dmd):
  - DreamShaper 8 (text encoder, VAE)                    ~2 GB
  - the DMD one-step UNet (aaronb/dreamshaper-8-dmd-1kstep) ~1.7 GB
  - IP-Adapter + its image encoder (reference images)    ~2.5 GB
  - TAESD (tiny, fast VAE for live frames)               ~10 MB
  - 3 style LoRAs into loras/ (pixel art, sketch, watercolor)
If a download stops halfway, just run this again: it carries on where it stopped.
"""
import time

import torch

import stream_server

t0 = time.time()
print(f"downloading models for painter '{stream_server.PAINTER}' — this can take a while on the first run ...")
stream_server.download_loras()
stream_server.load_pipe("cpu", torch.float32)     # loading once = downloading once
print(f"done in {time.time() - t0:.0f} s. LoRAs in loras/: {', '.join(stream_server.list_loras()) or 'none'}")
print("Now run:  python stream_server.py")
