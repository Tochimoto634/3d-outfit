/**
 * Demo / mock garment GLB used when a product has no TRELLIS Asset3D URL yet.
 * Binary: public/tryon/garments/sample-tee.glb
 * Theme-legal embed: extensions/.../garment-sample-data.js → window.__OutfitSampleGarmentGlb
 */

/** jsDelivr pin — bump when sample mesh changes and is pushed to main/PR branch. */
export const SAMPLE_GARMENT_CDN =
  "https://cdn.jsdelivr.net/gh/Tochimoto634/3d-outfit@cursor/gallery-tryon-slide-a47d/public/tryon/garments/sample-tee.glb";

export const SAMPLE_GARMENT_KIND = "base" as const;
export const SAMPLE_GARMENT_MIME = "model/gltf-binary";
