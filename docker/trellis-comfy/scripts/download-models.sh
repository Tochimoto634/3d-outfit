#!/usr/bin/env bash
# Download TRELLIS.2 weights into ComfyUI model dirs (optional image bake).
# Prefer Network Volume in production — this script is for explicit DOWNLOAD_MODELS=1 builds.
#
# Two common layouts (pick ONE to match your custom nodes):
#
# A) ComfyUI official / Comfy-Org repackage (recommended starting point):
#    https://huggingface.co/Comfy-Org/TRELLIS.2
#    models/clip_vision/dino_v3_vit_l.safetensors
#    models/diffusion_models/trellis_2_int8_convrot.safetensors  (+ optional trellis_2_bf16)
#    models/vae/trellis_2_shape_vae_bf16.safetensors
#    models/vae/trellis_2_texture_vae_bf16.safetensors
#    Optional for official tutorial: models/background_removal/birefnet.safetensors
#    Docs: https://docs.comfy.org/tutorials/3d/trellis2
#
# B) Microsoft raw snapshot (this script's default when TRELLIS_WEIGHTS_SOURCE=microsoft):
#    https://huggingface.co/microsoft/TRELLIS.2-4B → TRELLIS_MODEL_DIR
#    (PozzettiAndrea / SimpleTrellis2 / visualbruno may expect different subdirs —
#     confirm each node pack README before baking.)
#
# Override:
#   TRELLIS_WEIGHTS_SOURCE=comfy-org|microsoft   (default: microsoft for bake compat)
#   TRELLIS_MODEL_DIR=/comfyui/models/trellis2   (microsoft target)
#   COMFY_MODELS_DIR=/comfyui/models            (comfy-org target root)
set -euo pipefail

SOURCE="${TRELLIS_WEIGHTS_SOURCE:-microsoft}"

echo "==> TRELLIS.2 model download (scaffold)"
echo "    Source mode: ${SOURCE}"
echo "    Official MS: https://huggingface.co/microsoft/TRELLIS.2-4B"
echo "    Comfy-Org:   https://huggingface.co/Comfy-Org/TRELLIS.2"
echo "    Prefer Network Volume over image bake in production."
echo ""

if ! command -v huggingface-cli >/dev/null 2>&1 && ! python -c "import huggingface_hub" >/dev/null 2>&1; then
  pip install --no-cache-dir "huggingface_hub[cli]"
fi

# Large download — requires network + disk. HF token may be needed for gated deps
# (e.g. some DINOv3 / facebook models used by certain forks).

if [ "${SOURCE}" = "comfy-org" ]; then
  ROOT="${COMFY_MODELS_DIR:-/comfyui/models}"
  mkdir -p "${ROOT}/clip_vision" "${ROOT}/diffusion_models" "${ROOT}/vae" "${ROOT}/background_removal"
  echo "TODO / BLOCKER: after download, confirm your node pack reads Comfy-Org paths"
  echo "Attempting Comfy-Org/TRELLIS.2 → ${ROOT}"
  if python - <<'PY'
from huggingface_hub import snapshot_download
import os
from pathlib import Path

root = Path(os.environ.get("COMFY_MODELS_DIR", "/comfyui/models"))
# Snapshot into a staging dir, then callers can symlink into clip_vision/ etc.
staging = root / "_trellis2_comfy_org"
staging.mkdir(parents=True, exist_ok=True)
snapshot_download(
    repo_id="Comfy-Org/TRELLIS.2",
    local_dir=str(staging),
    local_dir_use_symlinks=False,
)
print("Downloaded Comfy-Org/TRELLIS.2 to", staging)
print("Place/symlink files per Comfy-Org README into clip_vision/, diffusion_models/, vae/")
PY
  then
    echo "Comfy-Org snapshot OK under ${ROOT}/_trellis2_comfy_org — arrange into models/* subdirs"
  else
    echo "WARN: Comfy-Org snapshot_download failed — use a GPU Pod + Network Volume"
    exit 1
  fi
else
  # Paths vary by custom node package. Adjust after you pick a node pack.
  # SimpleTrellis2 docs use models/trellis2; Registry TRELLIS2 may autodownload.
  TARGET="${TRELLIS_MODEL_DIR:-/comfyui/models/trellis2}"
  mkdir -p "${TARGET}"

  echo "TODO / BLOCKER: confirm the exact directory layout your chosen ComfyUI"
  echo "TRELLIS.2 nodes expect (ComfyUI-TRELLIS2 vs SimpleTrellis2 vs others)."
  echo "Attempting microsoft/TRELLIS.2-4B → ${TARGET}"

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
fi

echo "Done. Verify node docs for additional checkpoints (DINOv3, rembg, birefnet, etc.)."
echo "Next: export a real Comfy API workflow into app config/runpod-trellis-workflow.json"
echo "      (or RUNPOD_WORKFLOW_PATH). See Project doc runpod-trellis-weights-workflow.md"
