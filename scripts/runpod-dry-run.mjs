#!/usr/bin/env node
/**
 * Dry-run RunPod TRELLIS connect (no GPU spend unless --live-ping).
 * Does not print secret values.
 *
 *   npx tsx scripts/runpod-dry-run.mjs
 *   npx tsx scripts/runpod-dry-run.mjs --live-ping   # optional HEAD/status probe (needs keys)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const livePing = process.argv.includes("--live-ping");

function loadDotEnv() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return { loaded: false, applied: 0 };
  let applied = 0;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
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
      applied += 1;
    }
  }
  return { loaded: true, applied };
}

function mask(name) {
  const v = process.env[name]?.trim() || "";
  return v ? `SET(len=${v.length})` : "MISSING";
}

const envInfo = loadDotEnv();
console.log("[runpod-dry-run] .env", envInfo);
console.log("[runpod-dry-run] RUNPOD_API_KEY", mask("RUNPOD_API_KEY"));
console.log("[runpod-dry-run] RUNPOD_ENDPOINT_ID", mask("RUNPOD_ENDPOINT_ID"));
console.log(
  "[runpod-dry-run] RUNPOD_DRY_RUN",
  process.env.RUNPOD_DRY_RUN || "(unset)",
);
console.log(
  "[runpod-dry-run] RUNPOD_FORCE_MOCK",
  process.env.RUNPOD_FORCE_MOCK || "(unset)",
);

const runpod = await import(
  pathToFileURL(resolve(root, "app/services/runpod.server.ts")).href
);

const readiness = runpod.getRunPodLiveReadiness();
console.log("[runpod-dry-run] readiness", {
  liveReady: readiness.liveReady,
  canAttemptLiveSubmit: readiness.canAttemptLiveSubmit,
  mock: readiness.mock,
  dryRun: readiness.dryRun,
  blockers: readiness.blockers,
  nextStep: readiness.nextStep,
  placeholderNodes: readiness.placeholderNodes,
});

const payload = runpod.buildTrellisRunPayload({
  productSnapshotId: "dryrun_snapshot",
  images: [{ url: "https://example.com/product.jpg", alt: "dry-run" }],
});
if ("size_chart" in payload.input || "sizeChart" in payload.input) {
  console.error("[runpod-dry-run] FAIL size chart leaked");
  process.exit(1);
}
console.log("[runpod-dry-run] payload", {
  photo_only: payload.input.photo_only,
  images: payload.input.images.length,
  workflowNodeCount: Object.keys(payload.input.workflow || {}).filter(
    (k) => !k.startsWith("_"),
  ).length,
});

const extractDemo = runpod.extractAssetStubsFromOutput({
  message: { result: { glb_url: "https://cdn.example/out.glb" } },
  files: [{ filename: "worn.glb", url: "https://cdn.example/worn.glb" }],
  images: [{ url: "https://cdn.example/preview.png" }],
});
console.log(
  "[runpod-dry-run] extract",
  extractDemo.map((s) => ({ kind: s.kind, label: s.label || null })),
);
if (!extractDemo.some((s) => s.kind === "base" && s.url.endsWith(".glb"))) {
  console.error("[runpod-dry-run] FAIL extract missed glb");
  process.exit(1);
}

// Force dry-run submit path for this process if not already
if (!process.env.RUNPOD_DRY_RUN) process.env.RUNPOD_DRY_RUN = "1";
const submit = await runpod.submitTrellisRun({
  productSnapshotId: "dryrun_snapshot",
  images: [{ url: "https://example.com/product.jpg" }],
});
console.log("[runpod-dry-run] submit", {
  mode: submit.mode,
  status: submit.status,
  idPrefix: String(submit.externalRunId).slice(0, 16),
  dryRun: Boolean(submit.raw?.dryRun),
});

const status = await runpod.getTrellisRunStatus(submit.externalRunId);
const stubs = runpod.extractAssetStubsFromOutput(status.output);
console.log("[runpod-dry-run] mock-complete stubs", {
  status: status.status,
  stubs: stubs.map((s) => ({ kind: s.kind, urlHost: s.url.split("/")[2] })),
});

if (livePing) {
  if (!readiness.apiKeyConfigured || !readiness.endpointIdConfigured) {
    console.error(
      "[runpod-dry-run] --live-ping needs RUNPOD_API_KEY + RUNPOD_ENDPOINT_ID",
    );
    process.exit(2);
  }
  // Clear dry-run for a real submit attempt (user opted in).
  delete process.env.RUNPOD_DRY_RUN;
  delete process.env.RUNPOD_FORCE_MOCK;
  console.log(
    "[runpod-dry-run] LIVE PING: submitting one smoke image run (charges may apply)…",
  );
  const live = await runpod.submitTrellisRun({
    productSnapshotId: "liveping_snapshot",
    images: [{ url: "https://example.com/product.jpg", alt: "live-ping" }],
  });
  console.log("[runpod-dry-run] live submit", {
    mode: live.mode,
    status: live.status,
    idPrefix: String(live.externalRunId).slice(0, 16),
    endpointIdConfigured: Boolean(live.endpointId),
  });
  if (live.mode !== "live") {
    console.error("[runpod-dry-run] expected live mode after unset DRY_RUN");
    process.exit(3);
  }
}

console.log(
  "[runpod-dry-run] RESULT",
  readiness.liveReady
    ? "READY_FOR_ADMIN_CREATE"
    : readiness.canAttemptLiveSubmit
      ? "KEYS_OK_CHECK_WORKFLOW"
      : "NEED_SECRETS_OR_UNSET_DRY_RUN — see docs/runpod-live-connect.md",
);
