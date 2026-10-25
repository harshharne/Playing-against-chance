#!/usr/bin/env bash
# Run ONCE on the cloud GPU machine (Ubuntu + NVIDIA L4), inside the stream-proto folder:
#     bash setup_cloud.sh
# It installs Python packages and downloads the models (~5 GB). Takes about 10 minutes.
set -e
cd "$(dirname "$0")"

echo "== checking the GPU =="
if ! nvidia-smi >/dev/null 2>&1; then
  echo "The NVIDIA driver isn't ready yet. It installs itself on first boot (about 5 minutes)."
  echo "Wait a bit, run 'nvidia-smi' until it shows an NVIDIA L4, then run this script again."
  exit 1
fi
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader

echo "== system packages =="
sudo apt-get update -y -qq
sudo apt-get install -y -qq python3-venv python3-pip unzip

echo "== python packages =="
python3 -m venv .venv
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q torch                     # the standard Linux build already includes CUDA
pip install -q diffusers transformers peft accelerate fastapi "uvicorn[standard]" pillow numpy
python -c "import torch; print('torch', torch.__version__, '| GPU:', torch.cuda.get_device_name(0))"

echo "== models (one time, ~5 GB) =="
python download_models.py

echo
echo "Done. To start the server (every session):"
echo "    cd ~/stream-proto && source .venv/bin/activate && python stream_server.py"
