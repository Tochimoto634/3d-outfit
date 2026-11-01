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
const galleryJsPath = path.join(
  root,
  "extensions/storefront-tryon/assets/gallery-tryon.js",
);
const liquidPath = path.join(
  root,
  "extensions/storefront-tryon/blocks/try-on.liquid",
);
const galleryEmbedPath = path.join(
  root,
  "extensions/storefront-tryon/blocks/gallery-tryon-embed.liquid",
);
const formFieldsPath = path.join(
  root,
  "extensions/storefront-tryon/snippets/try-on-form-fields.liquid",
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
assert.match(liquid, /フォールバック|fallback|standalone/i);

assert.ok(fs.existsSync(galleryJsPath), "gallery-tryon.js missing");
assert.ok(fs.existsSync(galleryEmbedPath), "gallery-tryon-embed.liquid missing");
assert.ok(fs.existsSync(formFieldsPath), "try-on-form-fields.liquid missing");

const galleryJs = fs.readFileSync(galleryJsPath, "utf8");
assert.match(galleryJs, /slideshow-slide/);
assert.match(galleryJs, /media-gallery/);
assert.match(galleryJs, /3D試着|outfit-3d-tryon/);

const galleryEmbed = fs.readFileSync(galleryEmbedPath, "utf8");
assert.match(galleryEmbed, /"target": "body"/);
assert.match(galleryEmbed, /data-outfit-gallery-config/);
assert.match(galleryEmbed, /gallery-tryon\.js/);
assert.match(galleryEmbed, /3D試着/);

const tryOnCss = fs.readFileSync(
  path.join(root, "extensions/storefront-tryon/assets/try-on.css"),
  "utf8",
);
assert.match(tryOnCss, /outfit-tryon--gallery/);

assert.match(tryOnJs, /OutfitTryOn/);
assert.match(tryOnJs, /outfit:tryon:boot|outfit:tryon:ready/);
assert.match(tryOnJs, /minPolarAngle/);
assert.match(tryOnJs, /maxPolarAngle/);
assert.match(tryOnJs, /enableDamping\s*=\s*false/);
assert.match(tryOnJs, /enableZoom\s*=\s*false/);
assert.match(tryOnJs, /0xfafafa|studioBg|contactShadow/);
assert.match(tryOnJs, /fetchWithTimeout|Local-first|localMannequin/);
assert.match(tryOnJs, /__outfitTryOnCreate/);
assert.doesNotMatch(tryOnJs, /0xf2f2f2/);
assert.doesNotMatch(tryOnJs, /toggleAutoRotate|autoRotate\s*=\s*true/);
assert.doesNotMatch(tryOnJs, /enableDamping\s*=\s*true/);
assert.doesNotMatch(tryOnJs, /enableZoom\s*=\s*true/);
assert.match(tryOnCss, /#fafafa/);
assert.match(galleryJs, /wireFormSubmitGuard|__outfitTryOnPendingCreate/);

assert.match(galleryJs, /data-tryon-drawer/);
assert.match(galleryJs, /shieldInteractive|stopPropagation/);
assert.match(galleryJs, /shieldOrbitCanvas/);
assert.match(galleryJs, /data-tryon-orbit-host/);
assert.match(galleryJs, /outfit:tryon:drawer/);
assert.match(galleryEmbed, /data-tryon-drawer-toggle/);
assert.match(galleryEmbed, /data-tryon-layer="body"/);
assert.match(galleryEmbed, /data-tryon-layer="product"/);
assert.match(galleryEmbed, /人体モデル/);
assert.match(galleryEmbed, /商品/);
assert.doesNotMatch(galleryEmbed, /outfit-tryon__gallery-badge|aria-hidden="true">3D試着/);
assert.doesNotMatch(galleryEmbed, /自動回転|auto_rotate|data-tryon-toggle-rotate/);
assert.match(tryOnCss, /outfit-tryon__drawer/);
assert.match(tryOnCss, /outfit-tryon__layer-btn/);
assert.match(tryOnJs, /CONTENT_SCALE\s*=\s*1\.5|showProductOnlyPreview|setLayerVisible/);
assert.match(tryOnCss, /is-drawer-open/);
assert.match(tryOnCss, /touch-action:\s*none/);
assert.doesNotMatch(
  tryOnCss,
  /\.outfit-tryon__canvas-wrap\s*\{[^}]*touch-action:\s*none/s,
);
assert.match(tryOnJs, /outfit:tryon:drawer/);
assert.match(tryOnJs, /controls\.enabled/);
assert.match(tryOnJs, /getAzimuthalAngle|__outfitTryOnOrbit/);
assert.doesNotMatch(tryOnJs, /autoRotate\s*=\s*true/);

console.log("smoke:storefront-tryon OK", {
  femaleBmi: female.bmi,
  maleScale: male.overallScale,
  threeBundleBytes: fs.statSync(bundlePath).size,
  galleryEmbed: true,
  yawOnlyOrbit: true,
  noDamping: true,
  noZoom: true,
  ssenseStudioWhite: true,
  localFirstCreate: true,
  layerToggles: true,
  contentScale150: true,
  drawerInputShield: true,
  orbitCanvasShield: true,
});
