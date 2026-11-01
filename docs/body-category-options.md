# 試着ドロワー — 体型カテゴリ選択肢（TO-42）

**チケット:** TO-42（実装フォロー TO-43 / TO-45）  
**日付:** 2026-11-01  
**状態:** **実装済み**（Helio theme path / PR #12）。数値の身長・体重は維持。バランス／クランプは `categoryBiases` で常識範囲に収める。  
**前提:** MakeHuman 系ベースメッシュ。「普通」＝ベースライン（追加スケールなし）。

---

## 設計ルール

1. **「普通」＝ベースライン** — 追加スケールなし。性別ごとの基準体。
2. **性別で選択肢を分ける** — 共通軸＋性別専用軸。
3. **採寸 cm の詳細はカテゴリ優先** — 数値スリーサイズ入力は撤去（TO-45）。
4. **バランス** — 各軸独立ラベル。同時指定の極端重ねは `categoryBiases` で damp／clamp。
5. **身長・体重は数値のまま** — カテゴリ化しない（必須入力のまま）。

---

## 必須（数値）

| 項目 | UI | 備考 |
|------|-----|------|
| 身長 | 数値 cm | 必須 |
| 体重 | 数値 kg | 必須 |
| 性別 | 女性 / 男性 / 指定しない | 必須。カテゴリ軸の出し分けに使用 |

「指定しない」時は共通軸のみ表示し、カップ／男性胸厚は出さない。

---

## 共通カテゴリ（女性・男性とも）

各軸とも **デフォルト＝普通**。

### 筋肉量

| 値 | ラベル |
|----|--------|
| `normal` | 普通 |
| `slim` | 細め |
| `toned` | 引き締まっている |
| `muscular` | 筋肉質 |

### 脚の長さ（脚長・プロポーション）

| 値 | ラベル |
|----|--------|
| `normal` | 普通 |
| `short` | 短め |
| `long` | 長め |

### 肩幅

| 値 | ラベル |
|----|--------|
| `normal` | 普通 |
| `narrow` | 狭め |
| `wide` | 広め |

### ウエスト

| 値 | ラベル |
|----|--------|
| `normal` | 普通 |
| `slim` | 細め |
| `thick` | 太め |

### ヒップ

| 値 | ラベル |
|----|--------|
| `normal` | 普通 |
| `narrow` | すっきり |
| `wide` | 広め |

---

## 女性のみ — カップ（バスト）

| 値 | ラベル |
|----|--------|
| `normal` | 普通 |
| `a` | A カップ相当 |
| `b` | B カップ相当 |
| `c` | C カップ相当 |
| `d` | D カップ相当 |
| `e_plus` | E 以上 |

---

## 男性のみ — 胸の厚み

| 値 | ラベル |
|----|--------|
| `normal` | 普通 |
| `flat` | 薄め |
| `thick` | 厚め |
| `very_thick` | かなり厚め |

---

## ドロワー構成（実装済み）

```
体型設定
├ 身長（cm）*数値
├ 体重（kg）*数値
├ 性別 *
└ ▼ 体型カテゴリ（任意）  ← デフォルト折りたたみ
   ├ 筋肉量　　　[普通 ▼]
   ├ 脚の長さ　　[普通 ▼]
   ├ 肩幅　　　　[普通 ▼]
   ├ ウエスト　　[普通 ▼]
   ├ ヒップ　　　[普通 ▼]
   └ （女性）カップ　　[普通 ▼]
      （男性）胸の厚み　[普通 ▼]
```

---

## Payload

```json
{
  "heightCm": 170,
  "weightKg": 60,
  "gender": "female",
  "body": {
    "muscle": "normal",
    "legLength": "normal",
    "shoulder": "normal",
    "waist": "normal",
    "hip": "normal",
    "cup": "normal",
    "chestThickness": null
  }
}
```

- `gender === "male"` → `cup: null`, `chestThickness` set
- `gender === "female"` → `chestThickness: null`, `cup` set
- `gender === "unspecified"` → 両方 `null`
- 未選択・欠損はすべて `"normal"` 扱いでベースライン

---

## バランス／クランプ（実装済み）

コード: `app/lib/mannequin.ts` / `extensions/storefront-tryon/assets/try-on.js` → `categoryBiases`。

| 軸 | 値例 | 粗い倍率（普通＝1.0） |
|----|------|----------------------|
| muscle | slim / toned / muscular | 0.94 / 1.04 / 1.10 |
| legLength | short / long | 0.94 / 1.06（脚↔胴で相殺） |
| shoulder | narrow / wide | 0.94 / 1.08 |
| waist | slim / thick | 0.94 / 1.08 |
| hip | narrow / wide | 0.94 / 1.08 |
| cup | a…e_plus | 0.96〜1.12 |
| chestThickness | flat…very_thick | 0.94〜1.12 |

極端重ね時は per-axis clamp ＋ spread damp（合計偏差 > 0.35 で 1.0 方向へ圧縮）。身長スケールが主、カテゴリは相対バイアス。

---

## TO-42 チェックリスト

- [x] 本票の選択肢を確定
- [x] ドロワー UI（セレクト）＋ payload スキーマ
- [x] MakeHuman／スケールへのマッピング（普通＝単位行列相当）
- [x] 性別切り替えで専用軸の出し分け（カップ／胸の厚み）
- [x] 矛盾時のバランス／クランプ
- [x] 身長・体重は数値のまま

## 関連ファイル

- `extensions/storefront-tryon/snippets/try-on-form-fields.liquid`
- `extensions/storefront-tryon/assets/try-on.js`
- `app/lib/mannequin.ts`
- Helio theme restore: `outfit-gallery-tryon-restore.liquid` / `outfit-try-on.js`
