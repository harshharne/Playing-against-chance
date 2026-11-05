"""
Downloads every model the server needs, once. Run it inside the venv, on the machine that runs the server:
    python download_models.py                  the SD 1.5 painter (PAINTER=dmd, the default)
    PAINTER=sdxl python download_models.py     the SDXL painters as well (~20 GB more)

Everything is saved in ~/.cache/huggingface (LoRAs are copied into loras/), so the server finds it next time.
SD 1.5 (PAINTER=dmd): DreamShaper 8 + the DMD one-step UNet, IP-Adapter, TAESD, 3 style LoRAs, depth + OpenPose
  ControlNets, Depth Anything V2 small.
SDXL (PAINTER=sdxl): SDXL-Turbo (live avatar), DreamShaper XL Lightning (worlds, the baby), the fp16 SDXL VAE, TAESDXL,
  IP-Adapter Plus SDXL, the SDXL depth and OpenPose ControlNets.
Both: DWPose (whole-body detection; rtmlib downloads its ONNX models on first use).
If a download stops halfway, just run this again: it carries on where it stopped.
"""
import time

import torch

import stream_server

t0 = time.time()
print(f"downloading models for painter '{stream_server.PAINTER}' — this can take a while on the first run ...")
stream_server.download_loras()
stream_server.set_sizes("dmd")
stream_server.load_pipe("cpu", torch.float32)     # loading once = downloading once (SD 1.5 is also the fallback)
print("structure: ControlNets + depth reader ...")
stream_server.fetch_structure(torch.float32)
if stream_server.PAINTER == "sdxl":
    print("SDXL painters (this is the big one) ...")
    stream_server.load_sdxl("cpu", torch.float16)
    for kind in stream_server.SDXL_CONTROLNETS:
        stream_server.load_sdxl_controlnet(kind, torch.float16)
print("DWPose (whole-body detection) ...")
if stream_server.dwpose() is None:
    print("  DWPose isn't available:", stream_server._wb["error"], "(the server will use the browser's MediaPipe joints)")
else:
    print("  DWPose on", stream_server._wb["where"])
print(f"done in {time.time() - t0:.0f} s. LoRAs in loras/: {', '.join(stream_server.list_loras()) or 'none'}")
print("Now run:  python bench.py   (speed check)   then   PAINTER=sdxl python stream_server.py")
