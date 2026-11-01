/**
 * Smoke: parametric mannequin proportions + try-on payload shape (no Shopify / Three).
 */
import assert from "node:assert/strict";
import {
  buildMannequinProportions,
  parseTryOnBody,
} from "../app/lib/mannequin.ts";

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

console.log("smoke:storefront-tryon OK", {
  femaleBmi: female.bmi,
  maleScale: male.overallScale,
});
