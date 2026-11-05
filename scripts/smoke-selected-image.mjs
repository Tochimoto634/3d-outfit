#!/usr/bin/env node
/**
 * Smoke tests for Admin single-image selection helpers.
 * Run: npm run smoke:selected-image
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runner = resolve(tmpdir(), `selected-image-smoke-${process.pid}.mts`);

const source = `
import {
  collectedImageKey,
  defaultSelectedImageId,
  resolveSelectedImage,
  selectedImageIdFromForm,
  visibleMissingFlags,
  REVIEW_SELECTED_IMAGE_HELPER,
} from ${JSON.stringify(resolve(root, "app/lib/product-review.ts"))};
import { computeMissingFlags } from ${JSON.stringify(resolve(root, "app/services/product-collect.server.ts"))};

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const images = [
  { id: "img-a", url: "https://cdn.example/a.jpg", altText: "A" },
  { id: "img-b", url: "https://cdn.example/b.jpg", altText: "B" },
];

assert(
  REVIEW_SELECTED_IMAGE_HELPER ===
    "3Dモデルを作成するのに使用するため全体が分かりやすいものを選択。",
  "helper text exact match",
);

assert(defaultSelectedImageId(images) === "img-a", "default = first id");
assert(collectedImageKey(images[1]) === "img-b", "key prefers id");

const byDefault = resolveSelectedImage(images, null);
assert(byDefault?.id === "img-a", "null selection → first");

const byId = resolveSelectedImage(images, "img-b");
assert(byId?.id === "img-b", "saved id → that image");

const byUrl = resolveSelectedImage(images, "https://cdn.example/b.jpg");
assert(byUrl?.id === "img-b", "saved url → that image");

const stale = resolveSelectedImage(images, "missing");
assert(stale?.id === "img-a", "stale id → first");

const form = new FormData();
form.set("selectedImageId", "img-b");
assert(selectedImageIdFromForm(form) === "img-b", "form reads selectedImageId");

const chart = {
  rows: [{ size: "M", measurements: { bust: 50 } }],
  unit: "cm",
  incomplete: false,
  notes: [],
  rawMatches: [],
  source: "html_table",
};
const emptyMeta = {
  heightCm: null,
  weightKg: null,
  bustCm: null,
  waistCm: null,
  hipCm: null,
  sizeWorn: null,
  notes: [],
  sourceKeys: [],
};
const flags = computeMissingFlags({
  productFound: true,
  images: images as any,
  descriptionHtml: "<p>x</p>",
  sizeChart: chart as any,
  modelMeta: emptyMeta,
});
assert(!flags.includes("model_meta"), "Admin path no longer flags model_meta");

const emptyDescFlags = computeMissingFlags({
  productFound: true,
  images: images as any,
  descriptionHtml: "",
  sizeChart: chart as any,
  modelMeta: emptyMeta,
});
assert(
  !emptyDescFlags.includes("description"),
  "empty description must not be a missing flag",
);
assert(
  visibleMissingFlags(["images", "description", "model_meta", "size_chart"]).join(
    ",",
  ) === "images,size_chart",
  "不足フラグ hides description/model_meta",
);

console.log("smoke:selected-image OK");
`;

writeFileSync(runner, source);
const result = spawnSync("npx", ["tsx", runner], {
  cwd: root,
  encoding: "utf8",
  env: process.env,
});
try {
  unlinkSync(runner);
} catch {
  /* ignore */
}
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) {
  process.exit(result.status || 1);
}
