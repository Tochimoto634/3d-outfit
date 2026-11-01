#!/usr/bin/env bash
# Download TRELLIS.2 weights into ComfyUI model dirs (optional image bake).
# Prefer Network Volume in production — this script is for explicit DOWNLOAD_MODELS=1 builds.
set -euo pipefail

echo "==> TRELLIS.2 model download (scaffold)"
echo "    Official weights: https://huggingface.co/microsoft/TRELLIS.2-4B"
echo "    Shared decoder bits may also come from microsoft/TRELLIS-image-large"
echo ""

if ! command -v huggingface-cli >/dev/null 2>&1 && ! python -c "import huggingface_hub" >/dev/null 2>&1; then
  pip install --no-cache-dir "huggingface_hub[cli]"
fi

# Paths vary by custom node package. Adjust after you pick a node pack.
# SimpleTrellis2 docs use models/trellis2; Registry TRELLIS2 may autodownload.
TARGET="${TRELLIS_MODEL_DIR:-/comfyui/models/trellis2}"
mkdir -p "${TARGET}"

echo "TODO / BLOCKER: confirm the exact directory layout your chosen ComfyUI"
echo "TRELLIS.2 nodes expect (ComfyUI-TRELLIS2 vs SimpleTrellis2 vs others)."
echo "Attempting microsoft/TRELLIS.2-4B → ${TARGET}"

# Large download — requires network + disk. HF token may be needed for gated deps
# (e.g. some DINOv3 / facebook models used by certain forks).
if python - <<'PY'
from huggingface_hub import snapshot_download
import os
target = os.environ.get("TRELLIS_MODEL_DIR", "/comfyui/models/trellis2")
snapshot_download(
    repo_id="microsoft/TRELLIS.2-4B",
    local_dir=target,
    local_dir_use_symlinks=False,
)
print("Downloaded microsoft/TRELLIS.2-4B to", target)
PY
then
  echo "Primary TRELLIS.2-4B snapshot OK"
else
  echo "WARN: snapshot_download failed — leave Network Volume empty and retry on a Pod"
  exit 1
fi

# Optional sparse-structure decoder (SimpleTrellis2 README)
# huggingface-cli download microsoft/TRELLIS-image-large \
#   ckpts/ss_dec_conv3d_16l8_fp16.json \
#   ckpts/ss_dec_conv3d_16l8_fp16.safetensors \
#   --local-dir "${TARGET}"

echo "Done. Verify node docs for additional checkpoints (DINOv3, rembg, etc.)."
