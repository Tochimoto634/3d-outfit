# RunPod TRELLIS live connect → Asset3D → try-on (v23-GARM2)

**Goal:** Admin「3D作成」が **本物の garment GLB URL** を `Asset3D.storageUrl` に書き、ストアフロント try-on が `source=job` で読み込む。

**Date:** 2026-11-01  
**PR:** [#12](https://github.com/Tochimoto634/3d-outfit/pull/12)

## Pipeline

```
Admin Job「確認して作成開始」
  → submitTrellisRun (live | mock | dry-run)
  → EngineRun.externalRunId
  →「状態を更新」pollAndSyncEngineRuns
  → getTrellisRunStatus → output
  → extractAssetStubsFromOutput (glb_url / *.glb files)
  → Asset3D.storageUrl
  → storefront resolveStorefrontTryOn (source=job)
  → try-on.js loadPreferredGarment → MakeHuman + GLB
```

Badge on Helio try-on remains **v23-GARM2** (viewer). Live GLB replaces sample-tee when `storageUrl` is a job URL.

## Mock vs live vs dry-run

| Mode | When | Submit | Poll output | Asset3D |
|------|------|--------|-------------|---------|
| **mock** | no `RUNPOD_API_KEY` or `RUNPOD_FORCE_MOCK=1` | fake id `mock_*` | sample-tee CDN as `glb_url` | sample URL |
| **dry-run** | `RUNPOD_DRY_RUN=1` | no HTTP POST | same as mock | sample URL |
| **live** | key + endpoint, not force/dry | `POST /v2/{id}/run` | worker `glb_url` | **real GLB** |

## Secrets (user must provide — never commit)

Create `/path/to/3d-outfit/.env` (from `.env.example`):

```bash
RUNPOD_API_KEY=rp_••••          # RunPod → Settings → API Keys
RUNPOD_ENDPOINT_ID=••••         # NEW ComfyUI+TRELLIS.2 Serverless Endpoint ID only
# RUNPOD_API_BASE=https://api.runpod.ai/v2
# RUNPOD_FORCE_MOCK=1
# RUNPOD_DRY_RUN=1
# RUNPOD_WORKFLOW_PATH=config/runpod-trellis-workflow.json
```

Do **not** reuse unrelated endpoints (`silent_maroon_roundworm`, `wrong_rose_canidae`). Details: [runpod-setup.md](./runpod-setup.md).

This environment currently has **no `.env`** → Admin stays mock until you add keys and restart `shopify app dev`.

## Prefer dry-run, then connect

```bash
cd /path/to/3d-outfit
npm run dry-run:runpod
# readiness.liveReady false → set secrets
# After .env is filled:
npm run dry-run:runpod          # should show canAttemptLiveSubmit / liveReady
# Optional one real submit (may charge):
npm run dry-run:runpod -- --live-ping
npm run smoke:runpod
```

Then in Admin: open a job with product photos → **確認して作成開始** → **状態を更新** → confirm `Asset3D` row has https `.glb` URL (not only sample-tee).

## Worker output contract

`extractAssetStubsFromOutput` looks for (among others):

- `glb_url` / `gltf_url` / `model_url` / `mesh_url`
- `files[]` with `filename` ending `.glb` + `url`
- nested `message` / `output` / `result`

Worker must return an **https (or s3) URL** — not a huge `data:` blob (skipped on purpose). Upload GLB to R2/S3/CDN from the worker if needed.

## Workflow graph

Default `config/runpod-trellis-workflow.json` is a **placeholder** (`Trellis2ImageTo3D` / `SaveGLB` titles say placeholder). Replace with your Comfy export that matches the worker image, or set `RUNPOD_WORKFLOW_JSON` / `RUNPOD_WORKFLOW_PATH`.

Admin banner warns when `placeholderNodes` is true.

## Try-on (storefront)

Once `Asset3D.storageUrl` is a job GLB:

1. Helio theme path loads try-on **v23-GARM2**
2. Create mannequin → status should say **生成ジョブ GLB** (not サンプル服 / 布プロキシ)

## Checklist

- [ ] User adds `RUNPOD_API_KEY` + `RUNPOD_ENDPOINT_ID` to `.env`
- [ ] `npm run dry-run:runpod` → `liveReady` or `KEYS_OK_CHECK_WORKFLOW`
- [ ] Real TRELLIS workflow JSON wired
- [ ] Admin create + poll → `Asset3D.storageUrl` is product GLB
- [ ] Storefront try-on shows job mesh on MakeHuman
