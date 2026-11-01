#!/usr/bin/env node
/**
 * Rebuild extensions/storefront-tryon/assets/try-on-three.bundle.js
 * (Three.js + OrbitControls + GLTFLoader, ESM, CSP-safe for theme editor).
 *
 * Usage: npm run build:tryon-three
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "scripts/tryon-three-entry.mjs");
const outfile = path.join(
  root,
  "extensions/storefront-tryon/assets/try-on-three.bundle.js",
);

await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  outfile,
  minify: true,
  legalComments: "none",
});

console.log("built", path.relative(root, outfile));
