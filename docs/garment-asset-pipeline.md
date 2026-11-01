# 試着服 3D アセットパイプライン（TO-46）

**日付:** 2026-11-01  
**バッジ:** tryon **v23-GARM2**  
**PR:** [#12](https://github.com/Tochimoto634/3d-outfit/pull/12)  
**Live connect:** [runpod-live-connect.md](./runpod-live-connect.md)

## 現状フロー

```
Admin「3D作成」
  → GenerationJob / ProductSnapshot
  → RunPod TRELLIS (live) or mock
  → Asset3D.storageUrl (glb_url 等を extract)
  → Storefront POST /apps/3d-outfit/tryon | /api/storefront/tryon
  → resolveStorefrontTryOn()
  → try-on.js loadPreferredGarment()
       1. job GLB (source=job)
       2. sample-tee (source=sample) — テーマ embed or CDN
       3. 布プロキシ (last resort)
  → MakeHuman 人体に重ねて表示
```

## Mock vs real

| Mode | Asset3D.storageUrl | Viewer |
|------|--------------------|--------|
| Live RunPod + GLB in output | 抽出 URL | **job** GLB |
| Mock / no URL | sample-tee CDN | **sample** mesh |
| Theme offline (API fail) | — | client loads **sample** via `__OutfitSampleGarmentGlb` |
| Sample load fail | — | cloth cylinders |

## ファイル

| Path | Role |
|------|------|
| `public/tryon/garments/sample-tee.glb` | Demo tee binary |
| `extensions/.../garment-sample-data.js` | Theme-legal data URL embed |
| `app/lib/sample-garment.ts` | CDN pin + constants |
| `app/services/storefront-tryon.server.ts` | Prefer job URL → sample |
| `app/services/jobs.server.ts` | Mock upsert writes sample URL |
| Helio `outfit-garment-sample-data.js` | Theme-hosted same embed |

## 次の手（本番）

1. User secrets: `RUNPOD_API_KEY` + `RUNPOD_ENDPOINT_ID` in `.env` (see `runpod-live-connect.md`)
2. Replace placeholder Comfy/TRELLIS workflow so worker emits `glb_url`
3. Object storage for durable Asset3D URLs (not ephemeral RunPod links)
4. True garment fit / skinning (current: bbox scale onto chest)

Dry-run first: `npm run dry-run:runpod` (no GPU spend). Live ping optional: `npm run dry-run:runpod -- --live-ping`.

## Helio

Theme-hosted restore remains the live path. Badge `tryon v23-GARM2`. Hard-reload product → 3D試着; status should mention サンプル服 or 生成ジョブ GLB (not only 布プロキシ).
