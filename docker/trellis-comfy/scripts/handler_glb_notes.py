"""
Notes for wiring GLB https URLs into RunPod worker-comfyui output.

Stock `runpod/worker-comfyui` handler (5.x) walks ComfyUI prompt history and
collects only nodes that expose an `images` list. It then either:
  - base64-encodes the file (NOT acceptable for 3D OUTFIT Asset3D), or
  - uploads via BUCKET_* and returns { filename, type: "s3_url", data: url }.

SaveGLB / TRELLIS mesh nodes often put results under other history keys
(`result`, `gltf`, UI-only 3D previews, etc.). Those keys are logged as
"unhandled output keys" and **dropped** — so the Shopify app never sees a
`.glb` https URL.

3D OUTFIT app contract (extractAssetStubsFromOutput):
  - Prefer fields like glb_url / model_url / mesh_url
  - Or files[] with filename ending .glb + url
  - Or nested https URLs ending in .glb
  - Skips data: blobs on purpose

Recommended follow-ups (pick one):
  1. Fork handler.py: after history fetch, rglob /comfyui/output/**/*.glb,
     upload with glb_s3_upload.py / rp_upload, and return
     { "glb_url": "...", "files": [{ "filename": "...", "url": "..." }] }.
  2. Add a custom Comfy node that also writes a tiny PNG + sidecar JSON URL
     under `images` (hacky).
  3. Post-process in a thin wrapper around the stock handler.

Until one of these lands, Deploy-from-image will run Comfy but the Admin
poll path may stay without a durable garment GLB URL.
"""

HANDLER_GLB_BLOCKER = (
    "stock worker-comfyui ignores non-images history keys; "
    "wire GLB scan+S3 upload before relying on live Asset3D"
)
