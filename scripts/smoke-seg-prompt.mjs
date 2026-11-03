#!/usr/bin/env node
/**
 * Smoke: Shopify title → short Grounding/SAM2 default prompt.
 * Run: npm run smoke:seg-prompt
 */
import assert from "node:assert/strict";
import {
  effectiveProductTitlePrompt,
  normalizeProductTitlePrompt,
} from "../app/lib/product-review.ts";

function check(name, fn) {
  try {
    fn();
    console.log(`OK  ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

check("strips promo junk and keeps short category-like phrase", () => {
  const out = normalizeProductTitlePrompt(
    "【送料無料】2024 AW ★大人気★ オーバーサイズデニムジャケット / ブルー M〜L",
  );
  assert.equal(out, "オーバーサイズデニムジャケット");
});

check("strips trailing color/size from JP title", () => {
  assert.equal(
    normalizeProductTitlePrompt("プリーツスカート ベージュ F"),
    "プリーツスカート",
  );
  assert.equal(
    normalizeProductTitlePrompt("送料無料 限定SALE！ワイドパンツ L"),
    "ワイドパンツ",
  );
});

check("empty title → empty prompt", () => {
  assert.equal(normalizeProductTitlePrompt(""), "");
  assert.equal(normalizeProductTitlePrompt("   "), "");
  assert.equal(normalizeProductTitlePrompt(null), "");
});

check("effective prefers saved operator edit", () => {
  assert.equal(
    effectiveProductTitlePrompt("長い販促タイトル ジャケット", "denim jacket"),
    "denim jacket",
  );
  assert.equal(
    effectiveProductTitlePrompt("プレーンTシャツ", undefined),
    normalizeProductTitlePrompt("プレーンTシャツ"),
  );
  assert.equal(effectiveProductTitlePrompt("何か", "   "), "");
});

check("english short title stays usable", () => {
  const out = normalizeProductTitlePrompt("Classic Denim Jacket Blue");
  assert.ok(out.length > 0);
  assert.match(out.toLowerCase(), /denim|jacket|classic/);
});

console.log("smoke-seg-prompt: all passed");
