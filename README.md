# 3D OUTFIT

Shopify アパレル EC 向けの **3D 着用確認アプリ**（埋め込み Admin アプリ）。

購入者が自分の身体での着用感を購入前に確認できるようにし、サイズミスによる返品削減を目指します。

## アーキテクチャ（概要）

| 層 | 内容 |
| --- | --- |
| Shopify アプリ | React Router（旧 Remix 系公式テンプレート）+ Polaris Web Components |
| 起動導線 | 商品一覧の Admin Link / Selection Action「**3D作成**」→ 埋め込みジョブ画面 |
| データ | Prisma + SQLite（MVP）— `Shop` / `GenerationJob` / `ProductSnapshot` / `Asset3D` / `EngineRun` |
| 3D エンジン | RunPod 上の ComfyUI + TRELLIS.2（クライアントはスタブ + モック／ライブ切替） |

### フロー

1. 管理画面の商品一覧で商品を選択し「3D作成」を実行
2. アプリが Admin API で画像・説明文・メタフィールドを収集し、サイズ表をヒューリスティック解析（スタブ）
3. 運営者が確認・手動補正のうえ「確認して作成開始」
4. RunPod へ **写真のみ** の生成ジョブを投入（この段階ではサイズ表は使わない）
5. （後続）ベースモデル完成後に S/M/L 展開・ストアフロント試着 UI

## ローカル起動

前提: Node.js 22.12+、Shopify Partner アカウント、開発ストア。

```bash
npm install
npx prisma migrate deploy
npm run dev
# または
shopify app dev
```

初回は `shopify app config link` で Partner 上のアプリと紐付け、`client_id` を設定します。

ブラウザで表示されたプレビュー URL から開発ストアへインストールしてください。

## 環境変数

`.env.example` を参照。秘密情報はコミットしないでください。

| 変数 | 説明 |
| --- | --- |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | Partner アプリの認証情報（通常 CLI が注入） |
| `SCOPES` | 例: `write_products,read_products` |
| `SHOPIFY_APP_URL` | アプリ URL（`shopify app dev` がトンネルを設定） |
| `RUNPOD_API_KEY` | 未設定時は **モックモード** |
| `RUNPOD_ENDPOINT_ID` | RunPod Serverless エンドポイント ID |
| `RUNPOD_API_BASE` | 省略時 `https://api.runpod.ai/v2` |

## 主なパス

- `/app` — ホーム
- `/app/jobs` — ジョブ一覧
- `/app/jobs/new` — 選択商品 ID 受け取り → 収集開始
- `/app/jobs/:id` — レビュー UI と「確認して作成開始」
- `extensions/product-3d-create-link` — Admin Link（一括選択）
- `extensions/product-3d-bulk-action` — Selection Action モーダル

## 現状と次のステップ

- Phase 0 / Phase 1 開始: スキャフォールド、拡張、ジョブ画面スケルトン、Prisma、RunPod クライアント骨組み
- 未着手: 本格サイズ表テーブルパーサ、ComfyUI ワークフロー配線、アセットストレージ、ストアフロント試着

## ライセンス

ベーステンプレートは Shopify のテンプレートライセンスに従います。本リポジトリ固有コードのライセンスは別途定めるまで All Rights Reserved とします。
