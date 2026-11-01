# storefront-tryon（Theme App Extension）

購入者向け 3D 試着。Helio（Horizon 系）では **ギャラリー最終スライド** を推奨。

## ブロック

| 種類 | 名前 | 用途 |
|------|------|------|
| App Embed（`body`） | **ギャラリー最終スライド** | 商品写真の末尾に「3D試着」スライドを注入（推奨） |
| App Block（`section`） | **3D試着（単独ブロック）** | 任意フォールバック。別セクション／ギャラリー非対応テーマ向け |

## ギャラリー注入（Helio）

`gallery-tryon.js` が商品ページの `media-gallery` を検出し:

1. カルーセル: `slideshow-slide` を末尾追加 + サムネ／ドット
2. グリッド: デスクトップ用 `media-gallery__grid` にも末尾追加（モバイルは slideshow）
3. Dawn 系リスト / 隣接フォールバック

スライド内 UI はコンパクト（フォームは折りたたみ or モーダル）。日本語。

## Three.js

- 優先: 拡張アセット `assets/try-on-three.bundle.js`
- フォールバック: jsdelivr / unpkg / esm.sh + importmap
- 再生成: `npm run build:tryon-three`

## API ベース URL

通常は空欄（App Proxy）。詳細は `docs/storefront-tryon-api-base.md`。
