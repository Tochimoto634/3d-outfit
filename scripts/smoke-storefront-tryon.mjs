/**
 * Smoke: parametric mannequin proportions + try-on payload shape + Three bundle.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildMannequinProportions,
  parseTryOnBody,
} from "../app/lib/mannequin.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = path.join(
  root,
  "extensions/storefront-tryon/assets/try-on-three.bundle.js",
);
const tryOnJsPath = path.join(
  root,
  "extensions/storefront-tryon/assets/try-on.js",
);
const liquidPath = path.join(
  root,
  "extensions/storefront-tryon/blocks/try-on.liquid",
);

const female = buildMannequinProportions({
  heightCm: 160,
  weightKg: 52,
  gender: "female",
  bustCm: 84,
  waistCm: 64,
  hipCm: 90,
});

assert.equal(female.gender, "female");
assert.ok(female.overallScale < 1);
assert.ok(female.hipScale > female.waistScale);
assert.ok(female.bmi > 15 && female.bmi < 30);

const male = buildMannequinProportions({
  heightCm: 180,
  weightKg: 78,
  gender: "male",
});
assert.ok(male.shoulderScale > female.shoulderScale * 0.9);
assert.ok(male.overallScale > 1);

const bad = parseTryOnBody({ heightCm: 50, weightKg: 60, gender: "female" });
assert.equal(bad.ok, false);

const good = parseTryOnBody({
  heightCm: 170,
  weightKg: 60,
  gender: "unspecified",
  bustCm: "",
});
assert.equal(good.ok, true);
assert.equal(good.value.bustCm, null);

assert.ok(fs.existsSync(bundlePath), "try-on-three.bundle.js missing");
assert.ok(fs.statSync(bundlePath).size > 100_000, "three bundle too small");
const threeMod = await import(pathToFileURL(bundlePath).href);
assert.ok(threeMod.THREE?.Scene, "bundle missing THREE.Scene");
assert.equal(typeof threeMod.OrbitControls, "function");
assert.equal(typeof threeMod.GLTFLoader, "function");

const tryOnJs = fs.readFileSync(tryOnJsPath, "utf8");
assert.match(tryOnJs, /data-three-bundle|loadFromBundleUrl|ensureThree/);
assert.match(tryOnJs, /injectThreeImportMap/);

const liquid = fs.readFileSync(liquidPath, "utf8");
assert.match(liquid, /try-on-three\.bundle\.js/);
assert.match(liquid, /data-three-bundle/);

console.log("smoke:storefront-tryon OK", {
  femaleBmi: female.bmi,
  maleScale: male.overallScale,
  threeBundleBytes: fs.statSync(bundlePath).size,
});
