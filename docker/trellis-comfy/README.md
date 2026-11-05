# ComfyUI + TRELLIS.2 — RunPod Serverless Docker scaffold

3D OUTFIT 向けの **ドラフト** ワーカーイメージです。公式の「すぐ使える TRELLIS.2 公式イメージ」は無い前提で、`runpod/worker-comfyui` を土台にしたビルド可能なスキャフォールドを置いています。

## 使うイメージタグ（プレースホルダ）

ビルド／プッシュ後に RunPod の **Container Image** へ入れる値:

```text
YOUR_DOCKERHUB_USER/3d-outfit-trellis-comfy:0.1.0-draft
```

`YOUR_DOCKERHUB_USER` を自分の Docker Hub（または GHCR）ユーザー／Org に置き換えてください。

## ビルド & プッシュ

```bash
cd docker/trellis-comfy

docker build --platform linux/amd64 \
  -t YOUR_DOCKERHUB_USER/3d-outfit-trellis-comfy:0.1.0-draft \
  .

docker push YOUR_DOCKERHUB_USER/3d-outfit-trellis-comfy:0.1.0-draft
```

任意フラグ:

| Build-arg | 既定 | 説明 |
| --- | --- | --- |
| `WORKER_BASE` | `runpod/worker-comfyui:5.10.0-base` | 公式 base タグ |
| `TRELLIS_NODE_REPO` | PozzettiAndrea/ComfyUI-TRELLIS2 | カスタムノード Git URL |
| `INSTALL_TRELLIS_DEPS` | `0` | `1` で `requirements` / `install.py` を試行（失敗しやすい） |
| `DOWNLOAD_MODELS` | `0` | `1` で HF から重みをイメージに焼く（巨大・非推奨） |

## ブロッカー（正直な現状）

### 1. TRELLIS.2 Comfy ノードの公式インストール経路が不確定

- Microsoft 公式の「ComfyUI 用 Docker パッケージ」は未確認。
- コミュニティ候補:
  - [PozzettiAndrea/ComfyUI-TRELLIS2](https://github.com/PozzettiAndrea/ComfyUI-TRELLIS2)（Registry: `ComfyUI-TRELLIS2`）— **experimental `comfy-env` / pixi**。Docker 内ワンクリックは壊れやすい。
  - [starsFriday/ComfyUI-SimpleTrellis2](https://github.com/starsFriday/ComfyUI-SimpleTrellis2) — 単ノード寄り。torch/CUDA バージョン制約あり。
  - [visualbruno/ComfyUI-Trellis2](https://github.com/visualbruno/ComfyUI-Trellis2) — Windows wheel 中心。
- 本 Dockerfile は **git clone まで**を既定にし、重い依存解決は TODO。

**TODO:** GPU 付き一時 Pod でノードを動かし、成功した `pip` / wheel 手順を Dockerfile に固定する。

### 2. モデル重みはイメージに焼かない

- `microsoft/TRELLIS.2-4B` はマルチ GB。Network Volume（`/runpod-volume/models/...`）推奨。
- ComfyUI 公式寄りは [Comfy-Org/TRELLIS.2](https://huggingface.co/Comfy-Org/TRELLIS.2)（`clip_vision` / `diffusion_models` / `vae`）。
- `scripts/download-models.sh` は任意 bake 用。`TRELLIS_WEIGHTS_SOURCE=comfy-org|microsoft`。ノードが期待するディレクトリ配置はパッケージごとに違う → 要確認。
- 本番 workflow の載せ方（API export → `config/runpod-trellis-workflow.json` / `RUNPOD_WORKFLOW_PATH`）と live-ping 手順は Project ドキュメント **`runpod-trellis-weights-workflow.md`** を参照。

### 3. 株価 worker は GLB を https で返さないことがある

- `worker-comfyui` は主に history の `images` を処理。SaveGLB 等のキーは無視されがち。
- アプリは **https の `.glb` URL** が必要（`data:` はスキップ）。
- Endpoint に `BUCKET_*`（S3/R2）を設定し、`scripts/glb_s3_upload.py` を handler に配線する必要あり（`handler_glb_notes.py` 参照）。

## RunPod でのデプロイ（要約）

詳細な UI 手順は Project ドキュメント `docs/runpod-docker-image.md` を参照。

1. 上記タグを push
2. Serverless → **New Endpoint** → **Deploy from a Docker image**
3. Image: `YOUR_DOCKERHUB_USER/3d-outfit-trellis-comfy:0.1.0-draft`
4. **Queue** 型推奨（長時間 3D）。Load Balancer は短命向けで不向きになりがち
5. GPU **24GB 以上**（48GB あれば余裕）
6. Endpoint の Environment に S3/R2 用 `BUCKET_*`（`env.endpoint.example`）
7. 作成後の **Endpoint ID** だけを Shopify アプリの `.env` へ  
   `RUNPOD_API_KEY` + `RUNPOD_ENDPOINT_ID`（秘密はコミットしない）

**使わない Endpoint:** `silent_maroon_roundworm` / `wrong_rose_canidae`（別プロジェクト）

## アプリ側との契約

- Submit: `POST https://api.runpod.ai/v2/{ENDPOINT_ID}/run`
- Body: `{ input: { workflow, images, photo_only, product_snapshot_id, meta } }`
- Workflow プレースホルダ: リポジトリの `config/runpod-trellis-workflow.json`（別 PR にある場合あり）
- 成功 output に `glb_url` または `files[].url`（https `.glb`）

## 参考リンク

- RunPod ComfyUI tutorial: https://docs.runpod.io/tutorials/serverless/comfyui
- worker-comfyui customization: https://github.com/runpod-workers/worker-comfyui/blob/main/docs/customization.md
- Docker Hub tags: https://hub.docker.com/r/runpod/worker-comfyui/tags
