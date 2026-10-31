# RunPod setup (3D OUTFIT)

Live generation needs `RUNPOD_API_KEY` + `RUNPOD_ENDPOINT_ID` in a local `.env` (never commit secrets).

## Do NOT reuse these endpoints

They belong to a **previous unrelated project**:

- `silent_maroon_roundworm` (queue / 48GB)
- `wrong_rose_canidae` (load balancer / 24GB)

Create a **new** Serverless endpoint for ComfyUI + TRELLIS.2, then put **that** Endpoint ID into `RUNPOD_ENDPOINT_ID`.

## Create a new endpoint (ComfyUI + TRELLIS.2)

Hub one-click “ComfyUI” listings are often **FLUX image** workers — not TRELLIS.2 apparel 3D. Prefer a custom worker image that runs ComfyUI **and** your TRELLIS.2 nodes/models.

### Building blocks (references, not drop-in TRELLIS)

| Piece | Link / image | Notes |
| --- | --- | --- |
| Official ComfyUI Serverless tutorial | https://docs.runpod.io/tutorials/serverless/comfyui | Good for `/run` + workflow JSON shape |
| `worker-comfyui` | https://github.com/runpod-workers/worker-comfyui | Base API worker |
| Docker (base, no models) | `runpod/worker-comfyui:<version>-base` | Extend with TRELLIS.2 custom nodes |
| Official Hub ComfyUI | RunPod Hub → ComfyUI | Usually FLUX — **not** sufficient alone for TRELLIS.2 |

There is **no** fixed public `templateId` we can hard-require for “ComfyUI + TRELLIS.2 apparel” in this repo. Deploy your image → copy the resulting **Endpoint ID**.

### Steps

1. RunPod Console → **Serverless** → **New Endpoint**
2. Point it at your ComfyUI+TRELLIS.2 container (or GitHub worker repo)
3. Prefer **queue** workers and **≥24GB** VRAM for TRELLIS-class jobs
4. Open the endpoint detail → copy **Endpoint ID** (not the random display name)
5. Local `.env`:

```bash
RUNPOD_API_KEY=…          # Settings → API Keys
RUNPOD_ENDPOINT_ID=…      # new endpoint’s ID only
```

6. Restart `shopify app dev`

## Workflow JSON

- Default: `config/runpod-trellis-workflow.json` (placeholder Comfy graph — replace with your TRELLIS.2 export)
- Override: `RUNPOD_WORKFLOW_PATH` or `RUNPOD_WORKFLOW_JSON`
- **Photos only** — never put size-chart data in the workflow/payload

## App flow

1. Job review → **確認して作成開始** → `POST .../run` + `EngineRun` rows
2. **状態を更新** → `GET .../status/{id}` → `generating` → `ready` / `failed`
3. Success → `Asset3D` URL stubs from output

## Smoke

```bash
npm run smoke:runpod
```

Without keys → mock. With new endpoint credentials → live (secrets never printed).
