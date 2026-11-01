/**
 * Demo / mock garment GLB used when a product has no TRELLIS Asset3D URL yet.
 * Binary: public/tryon/garments/sample-tee.glb
 * Theme-legal embed: extensions/.../garment-sample-data.js → window.__OutfitSampleGarmentGlb
 */

/** jsDelivr pin — bump when sample mesh changes. GLB JSON chunk must be space-padded (not NUL). */
export const SAMPLE_GARMENT_CDN =
  "https://cdn.jsdelivr.net/gh/Tochimoto634/3d-outfit@a6f105f/public/tryon/garments/sample-tee.glb";

export const SAMPLE_GARMENT_KIND = "base" as const;
export const SAMPLE_GARMENT_MIME = "model/gltf-binary";
