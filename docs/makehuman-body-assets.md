# MakeHuman / MPFB body assets (CC0)

Temporary storefront try-on mannequin (option A) uses MakeHuman-derived base meshes instead of procedural capsules.

## Files

Shopify Theme App Extensions **cannot** ship `.glb` in `assets/` (only js/css/images/json/svg/wasm). Bodies are embedded as theme-legal JS data URLs, with binary copies under `public/` for app/CDN use.

| Asset | Path | Notes |
|-------|------|--------|
| Male (theme) | `extensions/storefront-tryon/assets/body-male-data.js` | Sets `window.__OutfitBodyMaleGlb` (data URL) |
| Female (theme) | `extensions/storefront-tryon/assets/body-female-data.js` | Sets `window.__OutfitBodyFemaleGlb` |
| Male (binary) | `public/tryon/bodies/body-male.glb` | Simplified A-pose ~1.79 m |
| Female (binary) | `public/tryon/bodies/body-female.glb` | Simplified A-pose ~1.59 m |

Source download (Innerscene library, adapted from MakeHuman CC0 assets):

- Male: https://www.innerscene.com/tools/library/3d-parts/male-base-mesh-3d-person-rigged-a-pose-380e6d89
- Female: https://www.innerscene.com/tools/library/3d-parts/female-base-mesh-3d-person-rigged-a-pose-dba97ed5

Meshes were simplified with `@gltf-transform/cli` (ratio ≈ 0.22) for theme-asset size; topology is still MakeHuman/MPFB-based.

## License

**CC0 1.0 Universal (public domain dedication).**

- MakeHuman / MPFB **core mesh assets** are dedicated **CC0** by the MakeHuman Community (see [LICENSE.ASSETS.md](https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.ASSETS.md)).
- Innerscene packages these as CC0 GLBs (“adapted from MakeHuman CC0 assets”).
- MPFB addon *code* is GPL; we ship **exported meshes only**, not the addon.

No attribution is required under CC0; this note is retained for provenance.

## Runtime scaling (best-effort)

`try-on.js` loads male or female by form gender, then:

1. Uniform scale so bounding height ≈ entered height (cm → m)
2. XZ scale from BMI / limb thickness
3. Soft shoulder/hip bias by gender
4. Ground soles to `y = 0`

Product mesh, layer toggles, framing (product ~75% / body ~50%), yaw-only orbit, and the drawer create flow are unchanged.
