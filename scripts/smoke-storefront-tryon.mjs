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
  body: { waist: "slim", cup: "d", muscle: "normal" },
});

assert.equal(female.gender, "female");
assert.ok(female.overallScale < 1);
assert.ok(female.hipScale > female.waistScale);
assert.ok(female.bmi > 15 && female.bmi < 30);
assert.equal(female.body.cup, "d");
assert.equal(female.body.chestThickness, null);
assert.equal(female.body.waist, "slim");
assert.ok(female.catBias.waist < 1);

const male = buildMannequinProportions({
  heightCm: 180,
  weightKg: 78,
  gender: "male",
  body: { chestThickness: "thick", shoulder: "wide" },
});
assert.ok(male.shoulderScale > female.shoulderScale * 0.9);
assert.ok(male.overallScale > 1);
assert.equal(male.body.cup, null);
assert.equal(male.body.chestThickness, "thick");
assert.ok(male.catBias.shoulder >= 1);

const stacked = buildMannequinProportions({
  heightCm: 170,
  weightKg: 60,
  gender: "female",
  body: {
    muscle: "muscular",
    legLength: "long",
    shoulder: "wide",
    waist: "thick",
    hip: "wide",
    cup: "e_plus",
  },
});
assert.ok(stacked.catBias.limb <= 1.12);
assert.ok(stacked.catBias.chest <= 1.16);

const bad = parseTryOnBody({ heightCm: 50, weightKg: 60, gender: "female" });
assert.equal(bad.ok, false);

const good = parseTryOnBody({
  heightCm: 170,
  weightKg: 60,
  gender: "unspecified",
  bustCm: "",
  body: { waist: "normal" },
});
assert.equal(good.ok, true);
assert.equal(good.value.bustCm, null);
assert.equal(good.value.body.cup, null);
assert.equal(good.value.body.chestThickness, null);
assert.equal(good.value.body.waist, "normal");

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
assert.match(tryOnJs, /FIT_FILL_PRODUCT\s*=\s*0\.75/);
assert.match(tryOnJs, /FIT_FILL_BODY\s*=\s*0\.5/);
assert.match(tryOnJs, /fitVisibleContent/);
assert.match(tryOnJs, /showProductOnlyPreview|setLayerVisible/);
assert.doesNotMatch(tryOnJs, /CONTENT_SCALE\s*=\s*1\.5/);
assert.match(tryOnJs, /mountMakeHumanBody|__OutfitBodyMaleGlb/);
assert.match(tryOnJs, /cdn\.jsdelivr\.net\/gh\/Tochimoto634\/3d-outfit/);
assert.match(tryOnJs, /ensureBodyDataScripts|BODY_CDN_MALE/);
assert.match(tryOnJs, /ALLOW_CAPSULE_FALLBACK\s*=\s*false/);
assert.match(tryOnJs, /OUTFIT_BODY_ASSET_V\s*=\s*"23-GARM"/);
assert.match(tryOnJs, /categoryBiases|normalizeBodyCats|syncGenderCategoryFields/);
assert.match(tryOnJs, /bodyMuscle|bodyWaist|bodyCup|bodyChestThickness/);
assert.match(tryOnJs, /loadPreferredGarment|SAMPLE_GARMENT_CDN|__OutfitSampleGarmentGlb/);
assert.match(tryOnJs, /生成ジョブ GLB|サンプル服メッシュ/);
assert.ok(
  fs.existsSync(path.join(root, "public/tryon/garments/sample-tee.glb")),
  "sample-tee.glb missing",
);
assert.ok(
  fs.existsSync(
    path.join(root, "extensions/storefront-tryon/assets/garment-sample-data.js"),
  ),
  "garment-sample-data.js missing",
);
assert.match(galleryEmbed, /garment-sample-data\.js/);
const formFields = fs.readFileSync(formFieldsPath, "utf8");
assert.match(formFields, /体型カテゴリ/);
assert.match(formFields, /outfit-tryon__more--cats/);
assert.match(formFields, /<details[^>]*data-tryon-body-cats/);
assert.doesNotMatch(formFields, /<details[^>]*data-tryon-body-cats[^>]*\sopen\b/);
assert.match(formFields, /name="bodyWaist"/);
assert.match(formFields, /data-tryon-cat-cup/);
assert.doesNotMatch(formFields, /上級：詳細サイズ|name="bustCm"|name="waistCm"|name="hipCm"/);
assert.doesNotMatch(formFields, /legend>スリーサイズ/);
assert.match(tryOnJs, /applyBodyDataText|fetchBodyDataFile|dataUrlToArrayBuffer|loader\.parse/);
assert.match(tryOnJs, /applyBodyDataText/);
assert.match(tryOnJs, /tryOnScriptBaseUrl|body-male-data\.js/);
assert.match(tryOnJs, /updateBuildBadge|data-tryon-build-badge/);
assert.match(tryOnJs, /rebuildCapsuleMannequin|capsule-fallback/);
assert.match(tryOnJs, /showProductOnlyPreview/);
assert.match(galleryEmbed, /v=23garm/);
assert.match(galleryEmbed, /data-tryon-build-badge/);
assert.match(galleryEmbed, /tryon v23-GARM/);
assert.match(galleryEmbed, /01a19540-d48d-7ee0-bc02-24b3c770447a/);
assert.match(galleryEmbed, /data-outfit-gallery/);
assert.match(galleryEmbed, /body-male-data\.js/);
assert.match(galleryEmbed, /body-female-data\.js/);
assert.match(liquid, /body-male-data\.js/);
assert.match(liquid, /data-tryon-build-badge/);
assert.doesNotMatch(liquid, /bustCm|詳細（任意・スリーサイズ）/);
assert.match(tryOnCss, /outfit-tryon__build-badge/);
assert.match(galleryJs, /applyBodyDataText|fetchOne|v=23garm/);
const bodyMaleData = path.join(
  root,
  "extensions/storefront-tryon/assets/body-male-data.js",
);
const bodyFemaleData = path.join(
  root,
  "extensions/storefront-tryon/assets/body-female-data.js",
);
assert.ok(fs.existsSync(bodyMaleData), "body-male-data.js missing");
assert.ok(fs.existsSync(bodyFemaleData), "body-female-data.js missing");
assert.ok(fs.statSync(bodyMaleData).size > 100_000, "body-male-data.js too small");
assert.ok(
  fs.existsSync(path.join(root, "public/tryon/bodies/body-male.glb")),
  "public body-male.glb missing",
);
assert.ok(fs.existsSync(path.join(root, "docs/makehuman-body-assets.md")));
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
  fitProduct75Body50: true,
  makeHumanBodyGlb: true,
  drawerInputShield: true,
  orbitCanvasShield: true,
});
