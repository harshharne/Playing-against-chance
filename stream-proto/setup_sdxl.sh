#!/usr/bin/env bash
# Run ONCE on the cloud GPU machine (chance-rtx), inside ~/stream-proto, with the venv active:
#     source .venv/bin/activate && bash setup_sdxl.sh
# Installs whole-body detection (DWPose via rtmlib, on the GPU through onnxruntime-gpu), downloads the SDXL models
# (~20 GB, ~10-20 min the first time) and runs the speed check. Safe to run again: it skips what's already there.
set -e
cd "$(dirname "$0")"
echo "== detection: rtmlib + onnxruntime-gpu =="
pip install -q rtmlib opencv-python-headless
pip uninstall -y -q onnxruntime || true          # the CPU build hides the GPU one
pip install -q "onnxruntime-gpu[cuda,cudnn]"      # with CUDA 12's cuBLAS + cuDNN, whatever torch brings
python -c "import onnxruntime as o; o.preload_dlls() if hasattr(o, 'preload_dlls') else None; print('onnxruntime providers:', o.get_available_providers())"
echo "== models =="
df -h ~ | tail -1
PAINTER=sdxl python download_models.py
echo "== speed check =="
PAINTER=sdxl python bench.py
echo
echo "Done. Start the server with:   PAINTER=sdxl python stream_server.py"
echo "(Without PAINTER=sdxl it runs the SD 1.5 painter as before. If SDXL fails to load, it falls back to SD 1.5 by itself.)"
