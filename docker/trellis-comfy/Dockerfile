# 3D OUTFIT — ComfyUI + TRELLIS.2 worker scaffold for RunPod Serverless
#
# Base: official RunPod ComfyUI serverless worker (no FLUX models).
# Pin: bump WORKER_BASE when https://hub.docker.com/r/runpod/worker-comfyui/tags
#      publishes a newer *-base you have verified.
#
# Image tag placeholder (replace YOUR_DOCKERHUB_USER before push):
#   YOUR_DOCKERHUB_USER/3d-outfit-trellis-comfy:0.1.0-draft
#
# This is a *buildable scaffold*, not a production-ready TRELLIS.2 image.
# See README.md for blockers (custom-node install path, model weights, GLB upload).

ARG WORKER_BASE=runpod/worker-comfyui:5.10.0-base
FROM ${WORKER_BASE}

LABEL org.opencontainers.image.title="3d-outfit-trellis-comfy"
LABEL org.opencontainers.image.description="Draft RunPod Serverless worker: ComfyUI + TRELLIS.2 custom nodes (scaffold)"
LABEL org.opencontainers.image.source="https://github.com/Tochimoto634/3d-outfit"

# ---------------------------------------------------------------------------
# TRELLIS.2 custom nodes
# ---------------------------------------------------------------------------
# Community packages (not an official Microsoft ComfyUI package):
#   - PozzettiAndrea/ComfyUI-TRELLIS2  (Comfy Registry: ComfyUI-TRELLIS2)
#     WARNING: uses experimental `comfy-env` / pixi — Docker install is fragile.
#   - starsFriday/ComfyUI-SimpleTrellis2 (simpler single-node alternative)
#   - visualbruno/ComfyUI-Trellis2 (Windows-oriented wheels; Linux needs care)
#
# Default strategy: git-clone the primary candidate. Heavy `install.py` / CUDA
# wheel resolution is LEFT AS A TODO so `docker build` stays reproducible.
# Set INSTALL_TRELLIS_DEPS=1 only after you verify the base image torch/CUDA
# matches the node’s expected wheels.

ARG TRELLIS_NODE_REPO=https://github.com/PozzettiAndrea/ComfyUI-TRELLIS2.git
ARG TRELLIS_NODE_DIR=ComfyUI-TRELLIS2
ARG TRELLIS_NODE_REF=main
# Optional alternate: https://github.com/starsFriday/ComfyUI-SimpleTrellis2.git
ARG INSTALL_TRELLIS_DEPS=0

WORKDIR /comfyui

RUN mkdir -p /comfyui/custom_nodes \
  && cd /comfyui/custom_nodes \
  && git clone --depth 1 --branch "${TRELLIS_NODE_REF}" "${TRELLIS_NODE_REPO}" "${TRELLIS_NODE_DIR}" \
  && echo "Cloned ${TRELLIS_NODE_REPO}@${TRELLIS_NODE_REF} → custom_nodes/${TRELLIS_NODE_DIR}"

# Soft dependency install (pip requirements only). Failures do not abort the
# scaffold build — check logs and complete manually / via Network Volume Pod.
RUN if [ "${INSTALL_TRELLIS_DEPS}" = "1" ]; then \
      set -e; \
      NODE="/comfyui/custom_nodes/${TRELLIS_NODE_DIR}"; \
      if [ -f "${NODE}/requirements.txt" ]; then \
        pip install --no-cache-dir -r "${NODE}/requirements.txt" || \
          echo "WARN: pip requirements failed — see README TODO"; \
      fi; \
      if [ -f "${NODE}/install.py" ]; then \
        python "${NODE}/install.py" || \
          echo "WARN: install.py failed (comfy-env/pixi/CUDA wheels?) — see README TODO"; \
      fi; \
    else \
      echo "INSTALL_TRELLIS_DEPS=0 — cloned nodes only. Run install on a GPU Pod or rebuild with INSTALL_TRELLIS_DEPS=1 after verifying torch/CUDA."; \
    fi

# Registry path (optional second attempt). Commented by default because the
# package name / isolated env may conflict with the git clone above.
# RUN comfy-node-install ComfyUI-TRELLIS2 || true

# ---------------------------------------------------------------------------
# Model weights — NOT baked by default (TRELLIS.2-4B is multi-GB)
# ---------------------------------------------------------------------------
# Preferred: RunPod Network Volume mounted at /runpod-volume with:
#   /runpod-volume/models/trellis2/...   (or paths your nodes expect)
# Optional bake (slow, large image):
#   docker build --build-arg DOWNLOAD_MODELS=1 ...
ARG DOWNLOAD_MODELS=0
COPY scripts/download-models.sh /usr/local/bin/download-trellis-models
RUN chmod +x /usr/local/bin/download-trellis-models \
  && if [ "${DOWNLOAD_MODELS}" = "1" ]; then \
       /usr/local/bin/download-trellis-models; \
     else \
       echo "DOWNLOAD_MODELS=0 — skip weight bake. Use Network Volume or rebuild with DOWNLOAD_MODELS=1."; \
     fi

# ---------------------------------------------------------------------------
# GLB → S3/R2 helper (stock worker-comfyui mainly handles output.images)
# ---------------------------------------------------------------------------
# Stock handler uploads under BUCKET_* only for Comfy history keys it knows
# (typically "images"). SaveGLB / mesh UI keys may be ignored → no https URL.
# This helper + notes document the gap; wire into a custom handler when ready.
COPY scripts/glb_s3_upload.py /opt/3d-outfit/glb_s3_upload.py
COPY scripts/handler_glb_notes.py /opt/3d-outfit/handler_glb_notes.py

# Placeholder workflow reminder (app also ships config/runpod-trellis-workflow.json)
COPY workflow/placeholder-notes.json /comfyui/user/default/workflows/3d-outfit-placeholder-notes.json

# Document expected RunPod endpoint env vars (values set in Console, not here)
ENV BUCKET_ENDPOINT_URL="" \
    BUCKET_ACCESS_KEY_ID="" \
    BUCKET_SECRET_ACCESS_KEY="" \
    BUCKET_PREFIX="3d-outfit/glb"

WORKDIR /
# Keep base image ENTRYPOINT/CMD (start.sh → handler.py)
