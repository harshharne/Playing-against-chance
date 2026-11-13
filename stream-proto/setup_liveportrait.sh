#!/usr/bin/env bash
# Run ONCE on the cloud GPU machine (chance-rtx), inside ~/stream-proto, with the venv active:
#     source .venv/bin/activate && bash setup_liveportrait.sh
# Installs the animation layer: LivePortrait's code (to ~/LivePortrait), what it needs, its weights (~0.6 GB),
# WebSocket support for the server, then runs the speed check. Safe to run again: it skips what's already there.
set -e
cd "$(dirname "$0")"
LP="${LIVEPORTRAIT_DIR:-$HOME/LivePortrait}"

echo "== WebSockets for the server =="
pip install -q "uvicorn[standard]"

echo "== LivePortrait code -> $LP =="
if [ ! -d "$LP/src" ]; then
  git clone --depth 1 https://github.com/KwaiVGI/LivePortrait.git "$LP"
else
  echo "already there"
fi

echo "== what it needs (keeps the torch that's already installed) =="
pip install -q pyyaml opencv-python-headless scipy imageio rich onnx scikit-image tyro pykalman huggingface_hub
pip uninstall -y -q onnxruntime || true          # the CPU build hides the GPU one
pip install -q onnxruntime-gpu
python -c "import onnxruntime as o; print('onnxruntime providers:', o.get_available_providers())"

echo "== weights (~0.6 GB) =="
python - "$LP" <<'PY'
import os, sys
from huggingface_hub import snapshot_download
lp = sys.argv[1]
if os.path.exists(os.path.join(lp, "pretrained_weights/liveportrait/base_models/warping_module.pth")):
    print("already there")
else:
    for repo in ("KlingTeam/LivePortrait", "KwaiVGI/LivePortrait"):
        try:
            snapshot_download(repo, local_dir=os.path.join(lp, "pretrained_weights"),
                              ignore_patterns=["*.git*", "README.md", "docs/*", "liveportrait_animals/*"])
            print("downloaded from", repo)
            break
        except Exception as e:
            print(repo, "failed:", str(e)[:200])
PY

echo "== speed check =="
python bench_animate.py

echo
echo "Done. Start the server as usual (PAINTER=sdxl python stream_server.py); the animator loads after the painter."
echo "Then on the Mac, through the tunnel: http://localhost:8766/animate.html"
