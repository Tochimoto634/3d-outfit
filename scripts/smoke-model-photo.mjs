#!/usr/bin/env node
/**
 * Smoke tests for on-model photo heuristics (no Shopify / CV).
 * Run: npm run smoke:model-photo
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runner = resolve(tmpdir(), `model-photo-smoke-${process.pid}.mts`);

const source = `
import {
  detectModelPhotoPresence,
  imageSuggestsModelPhoto,
  modelMetaOverrideFromForm,
  hasModelPhotoOverrideFromForm,
} from ${JSON.stringify(resolve(root, "app/lib/product-review.ts"))};
import { computeMissingFlags } from ${JSON.stringify(resolve(root, "app/services/product-collect.server.ts"))};

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const flatOnly = [
  {
    id: "1",
    url: "https://cdn.shopify.com/s/files/1/flat-lay-front.jpg",
    altText: "白Tシャツ 正面",
  },
];
const withModelAlt = [
  {
    id: "2",
    url: "https://cdn.shopify.com/s/files/1/shirt.jpg",
    altText: "モデル着用 正面",
  },
];
const withFilename = [
  {
    id: "3",
    url: "https://cdn.shopify.com/s/files/1/on_model_side.png",
    altText: null,
  },
];
const withRole = [
  {
    id: "4",
    url: "https://cdn.shopify.com/s/files/1/x.jpg",
    altText: null,
    mediaRole: "model",
  },
];

assert(!imageSuggestsModelPhoto(flatOnly[0]).match, "flat should not match");
assert(imageSuggestsModelPhoto(withModelAlt[0]).match, "着服用 alt should match");
assert(imageSuggestsModelPhoto(withFilename[0]).match, "on_model filename should match");
assert(imageSuggestsModelPhoto(withRole[0]).match, "mediaRole model should match");

const none = detectModelPhotoPresence(flatOnly, null);
assert(!none.hasModelPhoto && none.source === "none", "flat → no model photo");

const heur = detectModelPhotoPresence(withModelAlt, null);
assert(heur.hasModelPhoto && heur.source === "heuristic", "alt → heuristic");

const forcedOn = detectModelPhotoPresence(flatOnly, true);
assert(forcedOn.hasModelPhoto && forcedOn.source === "override_on", "override on");

const forcedOff = detectModelPhotoPresence(withModelAlt, false);
assert(!forcedOff.hasModelPhoto && forcedOff.source === "override_off", "override off");

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
const chart = { rows: [{ size: "M", measurements: { bust: 50 } }], unit: "cm", incomplete: false, notes: [], rawMatches: [], source: "html_table" };

const flagsNoModel = computeMissingFlags({
  productFound: true,
  images: flatOnly as any,
  descriptionHtml: "<p>x</p>",
  sizeChart: chart as any,
  modelMeta: emptyMeta,
  hasModelPhoto: false,
});
assert(!flagsNoModel.includes("model_meta"), "no model photo → no model_meta flag");

const flagsWithModel = computeMissingFlags({
  productFound: true,
  images: withModelAlt as any,
  descriptionHtml: "<p>x</p>",
  sizeChart: chart as any,
  modelMeta: emptyMeta,
  hasModelPhoto: true,
});
assert(flagsWithModel.includes("model_meta"), "model photo without meta → soft model_meta");

const hiddenForm = new FormData();
hiddenForm.set("hasModelPhotoOverridePosted", "1");
assert(hasModelPhotoOverrideFromForm(hiddenForm) === false, "unchecked → false");
assert(modelMetaOverrideFromForm(hiddenForm) === null, "hidden fields → null override");

const shownForm = new FormData();
shownForm.set("hasModelPhotoOverridePosted", "1");
shownForm.set("hasModelPhotoOverride", "1");
shownForm.set("modelFieldsEnabled", "1");
shownForm.set("model_heightCm", "165");
assert(hasModelPhotoOverrideFromForm(shownForm) === true, "checked → true");
const meta = modelMetaOverrideFromForm(shownForm);
assert(meta != null && meta.heightCm === 165, "enabled fields read height");

console.log("smoke:model-photo OK");
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
