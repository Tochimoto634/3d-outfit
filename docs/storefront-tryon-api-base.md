# Storefront try-on — API base URL（テーマエディタ）

試着 App Block の設定 **「API ベース URL」** は通常 **空欄** で問題ありません。空欄時はストアの App Proxy:

```text
POST /apps/3d-outfit/tryon
```

を使います（`shopify.app.toml` の `[app_proxy]` → アプリの `/api/proxy/tryon`）。

## いつトンネル URL を入れるか

次の場合だけ、ブロック設定に `shopify app dev` のトンネル origin を入れてください。

- テーマエディタ（カスタマイズ）プレビューで App Proxy が届かない
- ローカル開発中に CORS の `/api/storefront/tryon` を直接叩いて確認したい

空欄のままでも、API 不通時は **ローカル体型プレビュー（布プロキシ）** にフォールバックします。Three.js 自体は拡張アセット `try-on-three.bundle.js` から読み込むため、API URL 未設定でもビューア起動はできます。

## 設定手順

1. リポジトリで開発サーバーを起動する:

   ```bash
   npm install
   npx prisma migrate deploy
   npm run dev
   # または: shopify app dev
   ```

2. CLI 出力のアプリ URL を控える。例:

   ```text
   https://abcd-1234.trycloudflare.com
   ```

   （環境によって `ngrok` / Shopify 提供ホストなど。**https の origin のみ** — パスは付けない）

3. 管理画面 → **オンラインストア → テーマ → カスタマイズ** → 商品ページの **3D試着ビューア** ブロックを開く。

4. **API ベース URL** に上記 origin を貼る（末尾 `/` なし）。

5. 保存後、身長・体重・性別を入れて「マネキンを作成して試着」を押す。

フロントは次を呼びます:

```text
POST {API_BASE}/api/storefront/tryon?shop=…&product_id=…
```

## 注意

- トンネル URL は `shopify app dev` をやり直すたびに変わることが多い。変わったらブロック設定を更新する。
- 本番／共同プレビューでは空欄 + App Proxy を推奨（`automatically_update_urls_on_dev` が dev 中の proxy 先をトンネルに合わせる）。
- Three.js は CDN ではなく Theme App Extension アセット優先。再ビルドは `npm run build:tryon-three`。
