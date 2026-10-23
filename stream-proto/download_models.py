"""
Downloads every model the server needs, once. Run it inside the venv:
    python download_models.py

Everything is saved in ~/.cache/huggingface, so the server finds it next time without downloading.
About 5 GB for the default engine:
  - DreamShaper 8 (an SD 1.5 model)                      ~2 GB
  - LCM-LoRA (makes it work in 1–4 steps)                ~135 MB
  - IP-Adapter + its image encoder (reference images)    ~2.5 GB
  - TAESD (tiny, fast VAE for live frames)               ~10 MB
If a download stops halfway, just run this again: it carries on where it stopped.
"""
import time

import torch

import stream_server

t0 = time.time()
print(f"downloading models for engine '{stream_server.ENGINE}' — this can take a while on the first run ...")
stream_server.load_pipe("cpu", torch.float32)     # loading once = downloading once
print(f"done in {time.time() - t0:.0f} s. Now run:  python stream_server.py")
