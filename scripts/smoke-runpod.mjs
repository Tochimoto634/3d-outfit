#!/usr/bin/env node
/**
 * Smoke-test RunPod client without printing secrets.
 * Loads .env if present (KEY=VALUE lines only).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return { loaded: false };
  const text = readFileSync(envPath, "utf8");
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = val;
      count += 1;
    }
  }
  return { loaded: true, applied: count };
}

function maskPresence(name) {
  const v = process.env[name]?.trim() || "";
  return v ? `SET(len=${v.length})` : "MISSING";
}

const envInfo = loadDotEnv();
console.log("[smoke-runpod] cwd=", root);
console.log("[smoke-runpod] .env", envInfo);
console.log("[smoke-runpod] RUNPOD_API_KEY", maskPresence("RUNPOD_API_KEY"));
console.log(
  "[smoke-runpod] RUNPOD_ENDPOINT_ID",
  maskPresence("RUNPOD_ENDPOINT_ID"),
);

const modPath = resolve(root, "app/services/runpod.server.ts");
// Prefer built/transpiled import via tsx if available; else dynamic via vite-node-less path:
// For smoke we duplicate minimal checks by importing after registering ts via node --experimental?
// Use a small inline reimplementation of status mapping + call compiled path.
// Shopify app runs TS via Vite; here we spawn tsx if present.

async function main() {
  let runpod;
  try {
    // When executed via `npx tsx scripts/smoke-runpod.mjs` this still works if we import .ts
    runpod = await import(pathToFileURL(modPath).href);
  } catch (err) {
    console.error(
      "[smoke-runpod] Failed to import runpod.server.ts directly.",
      "Run: npx tsx scripts/smoke-runpod.mjs",
    );
    console.error(String(err?.message || err));
    process.exit(1);
  }

  const publicCfg = runpod.getRunPodPublicConfig();
  console.log("[smoke-runpod] publicConfig", publicCfg);

  const workflow = runpod.loadTrellisWorkflow();
  console.log("[smoke-runpod] workflowKeys", Object.keys(workflow).slice(0, 12));

  const payload = runpod.buildTrellisRunPayload({
    productSnapshotId: "smoke_snapshot",
    images: [{ url: "https://example.com/smoke.jpg", alt: "smoke" }],
    meta: {
      product_title: "【送料無料】デニムジャケット",
      product_title_prompt: "デニムジャケット",
      shopifyProductId: "gid://shopify/Product/1",
    },
  });
  if ("size_chart" in payload.input || "sizeChart" in payload.input) {
    console.error("[smoke-runpod] FAIL: size chart leaked into payload");
    process.exit(1);
  }
  if (payload.input.meta?.product_title_prompt !== "デニムジャケット") {
    console.error(
      "[smoke-runpod] FAIL: product_title_prompt missing from meta",
      payload.input.meta,
    );
    process.exit(1);
  }
  console.log("[smoke-runpod] payload.photo_only", payload.input.photo_only);
  console.log("[smoke-runpod] payload.image_count", payload.input.images.length);
  console.log(
    "[smoke-runpod] payload.meta.product_title_prompt",
    payload.input.meta.product_title_prompt,
  );

  const submit = await runpod.submitTrellisRun({
    productSnapshotId: "smoke_snapshot",
    images: [{ url: "https://example.com/smoke.jpg", alt: "smoke" }],
  });
  console.log("[smoke-runpod] submit", {
    mode: submit.mode,
    status: submit.status,
    externalRunIdPrefix: String(submit.externalRunId).slice(0, 12),
    endpointIdConfigured: Boolean(submit.endpointId),
  });

  const status = await runpod.getTrellisRunStatus(submit.externalRunId);
  console.log("[smoke-runpod] status", {
    mode: status.mode,
    status: status.status,
    hasOutput: status.output != null,
  });

  const mapped = runpod.mapRunPodStatusToEngine(status.status);
  console.log("[smoke-runpod] mappedEngineStatus", mapped);

  const stubs = runpod.extractAssetStubsFromOutput({
    glb_url: "https://example.com/out.glb",
    images: [{ url: "https://example.com/preview.png" }],
  });
  console.log(
    "[smoke-runpod] extractAssetStubs",
    stubs.map((s) => ({ kind: s.kind, hasUrl: Boolean(s.url) })),
  );

  console.log(
    "[smoke-runpod] RESULT",
    submit.mode === "live"
      ? "LIVE_CALL_ATTEMPTED"
      : "MOCK_ONLY (set RUNPOD_API_KEY + RUNPOD_ENDPOINT_ID for live)",
  );
}

main().catch((err) => {
  console.error("[smoke-runpod] ERROR", err?.message || err);
  process.exit(1);
});
