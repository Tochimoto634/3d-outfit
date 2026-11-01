# storefront-tryon（Theme App Extension）

商品ページ用 App Block「**3D試着ビューア**」。

1. 身長・体重・性別（必須）+ 任意のスリーサイズ
2. パラメトリックマネキン生成
3. Asset3D GLB があれば着用表示、無ければ布プロキシ
4. OrbitControls による 360° ターンテーブル

## Three.js

- 優先: 拡張アセット `assets/try-on-three.bundle.js`（Shopify CDN・テーマエディタ CSP 向け）
- フォールバック: jsdelivr / unpkg / esm.sh + importmap（bare `three` 解決）
- バンドル再生成（リポジトリルート）: `npm run build:tryon-three`

## API ベース URL

通常は空欄（App Proxy）。テーマエディタでトンネルが必要な場合は `docs/storefront-tryon-api-base.md` を参照。

有効化手順はリポジトリ外 Context の `docs` / `internal/storefront-tryon.md` も参照。
