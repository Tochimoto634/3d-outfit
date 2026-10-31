/**
 * RunPod client for ComfyUI / TRELLIS.2 workflows.
 *
 * Env:
 * - RUNPOD_API_KEY           (required for live calls; mock mode if missing)
 * - RUNPOD_ENDPOINT_ID       (serverless endpoint id)
 * - RUNPOD_API_BASE          (optional, default https://api.runpod.ai/v2)
 * - RUNPOD_WORKFLOW_PATH     (optional JSON file with ComfyUI graph)
 * - RUNPOD_WORKFLOW_JSON     (optional inline JSON string; wins over path)
 *
 * Constraint: 3D generation uses photos only — never send size-chart data.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export type RunPodImageInput = {
  url: string;
  alt?: string | null;
};

export type TrellisWorkflowInput = {
  /** Product / snapshot identifier for tracing */
  productSnapshotId: string;
  /** Photo URLs only — size chart must NOT be included */
  images: RunPodImageInput[];
  /** Optional ComfyUI workflow graph JSON (overrides env/file default) */
  workflow?: Record<string, unknown>;
  /** Extra non-secret metadata */
  meta?: Record<string, unknown>;
};

export type RunPodJobStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type RunPodSubmitResult = {
  mode: "live" | "mock";
  endpointId: string | null;
  externalRunId: string;
  status: RunPodJobStatus;
  raw: unknown;
};

export type RunPodStatusResult = {
  mode: "live" | "mock";
  externalRunId: string;
  status: RunPodJobStatus;
  output: unknown;
  raw: unknown;
};

/** App-side EngineRun status mapped from RunPod. */
export type EngineRunMappedStatus =
  | "queued"
  | "submitted"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ExtractedAssetStub = {
  url: string;
  mimeType: string | null;
  kind: "base" | "preview" | "intermediate";
  label?: string;
};

function getConfig() {
  const apiKey = process.env.RUNPOD_API_KEY?.trim() || "";
  const endpointId = process.env.RUNPOD_ENDPOINT_ID?.trim() || "";
  const apiBase =
    process.env.RUNPOD_API_BASE?.trim() || "https://api.runpod.ai/v2";
  return { apiKey, endpointId, apiBase, mock: !apiKey };
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Load ComfyUI / TRELLIS workflow graph from env or config file.
 * Priority: explicit arg → RUNPOD_WORKFLOW_JSON → RUNPOD_WORKFLOW_PATH →
 * config/runpod-trellis-workflow.json → built-in placeholder.
 */
export function loadTrellisWorkflow(
  override?: Record<string, unknown>,
): Record<string, unknown> {
  if (override && Object.keys(override).length > 0) return override;

  const inline = process.env.RUNPOD_WORKFLOW_JSON?.trim();
  if (inline) {
    return parseJsonObject(inline, "RUNPOD_WORKFLOW_JSON");
  }

  const configuredPath = process.env.RUNPOD_WORKFLOW_PATH?.trim();
  const candidates = [
    configuredPath,
    "config/runpod-trellis-workflow.json",
    "config/runpod-trellis-workflow.example.json",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const abs = resolve(process.cwd(), candidate);
    if (!existsSync(abs)) continue;
    const raw = readFileSync(abs, "utf8");
    return parseJsonObject(raw, abs);
  }

  return {
    _todo: "Wire ComfyUI + TRELLIS.2 graph (no workflow file found)",
    nodes: {},
  };
}

/**
 * Build the HTTP payload shape for a TRELLIS / ComfyUI run.
 * Intentionally omits any size-chart fields.
 */
export function buildTrellisRunPayload(input: TrellisWorkflowInput) {
  if (!input.images.length) {
    throw new Error("TRELLIS run requires at least one product image");
  }

  const workflow = loadTrellisWorkflow(input.workflow);

  return {
    input: {
      // Photo-only generation (size chart excluded by design)
      photo_only: true as const,
      product_snapshot_id: input.productSnapshotId,
      images: input.images.map((img, index) => ({
        name: `input_${index}.jpg`,
        url: img.url,
        alt: img.alt ?? null,
      })),
      // ComfyUI graph expected by many RunPod serverless Comfy workers
      workflow,
      meta: {
        ...(input.meta ?? {}),
        photo_only: true,
        // Explicit: never attach size_chart / sizeChart here
      },
    },
  };
}

async function runpodFetch(
  path: string,
  init: RequestInit & { apiKey: string },
): Promise<Response> {
  const { apiKey, ...rest } = init;
  return fetch(path, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(rest.headers || {}),
    },
  });
}

function normalizeRunPodStatus(raw: unknown): RunPodJobStatus {
  const s = String(raw || "")
    .trim()
    .toUpperCase();
  if (s === "IN_QUEUE" || s === "QUEUED") return "IN_QUEUE";
  if (s === "IN_PROGRESS" || s === "RUNNING") return "IN_PROGRESS";
  if (s === "COMPLETED" || s === "COMPLETE" || s === "SUCCESS")
    return "COMPLETED";
  if (s === "FAILED" || s === "ERROR") return "FAILED";
  if (s === "CANCELLED" || s === "CANCELED") return "CANCELLED";
  return "IN_PROGRESS";
}

/** Map RunPod status → EngineRunStatus enum values. */
export function mapRunPodStatusToEngine(
  status: RunPodJobStatus,
): EngineRunMappedStatus {
  switch (status) {
    case "IN_QUEUE":
      return "submitted";
    case "IN_PROGRESS":
      return "running";
    case "COMPLETED":
      return "succeeded";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "running";
  }
}

function guessMime(url: string): string | null {
  const lower = url.toLowerCase().split("?")[0] || "";
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  if (lower.endsWith(".obj")) return "model/obj";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return null;
}

function pushUrl(
  out: ExtractedAssetStub[],
  seen: Set<string>,
  url: unknown,
  kind: ExtractedAssetStub["kind"],
  label?: string,
) {
  if (typeof url !== "string") return;
  const trimmed = url.trim();
  if (!trimmed || (!trimmed.startsWith("http") && !trimmed.startsWith("s3://")))
    return;
  if (seen.has(trimmed)) return;
  seen.add(trimmed);
  out.push({
    url: trimmed,
    mimeType: guessMime(trimmed),
    kind,
    label,
  });
}

/**
 * Best-effort extraction of result asset URLs from heterogeneous RunPod/Comfy outputs.
 */
export function extractAssetStubsFromOutput(output: unknown): ExtractedAssetStub[] {
  const stubs: ExtractedAssetStub[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown, depth: number) => {
    if (node == null || depth > 8) return;
    if (typeof node === "string") {
      pushUrl(stubs, seen, node, "base");
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;

    const obj = node as Record<string, unknown>;
    for (const key of [
      "glb_url",
      "model_url",
      "asset_url",
      "mesh_url",
      "output_url",
      "url",
    ]) {
      if (key in obj) {
        const kind =
          key.includes("preview") || String(obj.mimeType || "").startsWith("image/")
            ? "preview"
            : "base";
        pushUrl(stubs, seen, obj[key], kind, key);
      }
    }

    if (Array.isArray(obj.images)) {
      for (const img of obj.images) {
        if (typeof img === "string") pushUrl(stubs, seen, img, "preview");
        else if (img && typeof img === "object") {
          const rec = img as Record<string, unknown>;
          pushUrl(stubs, seen, rec.url || rec.data, "preview");
        }
      }
    }

    if (Array.isArray(obj.files)) {
      for (const file of obj.files) {
        if (typeof file === "string") pushUrl(stubs, seen, file, "base");
        else if (file && typeof file === "object") {
          const rec = file as Record<string, unknown>;
          pushUrl(stubs, seen, rec.url || rec.path, "base");
        }
      }
    }

    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") visit(value, depth + 1);
    }
  };

  visit(output, 0);
  return stubs;
}

/**
 * Submit a run to RunPod serverless endpoint.
 * Falls back to deterministic mock when RUNPOD_API_KEY is absent.
 */
export async function submitTrellisRun(
  input: TrellisWorkflowInput,
): Promise<RunPodSubmitResult> {
  const { apiKey, endpointId, apiBase, mock } = getConfig();
  const payload = buildTrellisRunPayload(input);

  if (mock) {
    const externalRunId = `mock_${Date.now()}_${input.productSnapshotId.slice(0, 8)}`;
    return {
      mode: "mock",
      endpointId: endpointId || null,
      externalRunId,
      status: "IN_QUEUE",
      raw: {
        mock: true,
        message:
          "RUNPOD_API_KEY missing — mock submit. Set key + RUNPOD_ENDPOINT_ID for live calls.",
        payload_summary: {
          photo_only: true,
          image_count: input.images.length,
          product_snapshot_id: input.productSnapshotId,
          workflow_keys: Object.keys(payload.input.workflow || {}),
        },
      },
    };
  }

  if (!endpointId) {
    throw new Error(
      "RUNPOD_ENDPOINT_ID is required when RUNPOD_API_KEY is set",
    );
  }

  const url = `${apiBase.replace(/\/$/, "")}/${endpointId}/run`;
  const res = await runpodFetch(url, {
    method: "POST",
    apiKey,
    body: JSON.stringify(payload),
  });

  const raw = await res.json().catch(() => ({ statusText: res.statusText }));
  if (!res.ok) {
    throw new Error(
      `RunPod submit failed (${res.status}): ${JSON.stringify(raw)}`,
    );
  }

  const body = raw as { id?: string; status?: string };
  return {
    mode: "live",
    endpointId,
    externalRunId: body.id || `unknown_${Date.now()}`,
    status: normalizeRunPodStatus(body.status || "IN_QUEUE"),
    raw,
  };
}

/**
 * Poll RunPod run status.
 */
export async function getTrellisRunStatus(
  externalRunId: string,
): Promise<RunPodStatusResult> {
  const { apiKey, endpointId, apiBase, mock } = getConfig();

  if (mock || externalRunId.startsWith("mock_")) {
    return {
      mode: "mock",
      externalRunId,
      status: "COMPLETED",
      output: {
        mock: true,
        glb_url: null,
        message:
          "Mock run completed — no GLB produced. Configure RUNPOD_API_KEY for live assets.",
        files: [],
      },
      raw: { mock: true, status: "COMPLETED" },
    };
  }

  if (!endpointId) {
    throw new Error("RUNPOD_ENDPOINT_ID is required for status polling");
  }

  const url = `${apiBase.replace(/\/$/, "")}/${endpointId}/status/${externalRunId}`;
  const res = await runpodFetch(url, { method: "GET", apiKey });
  const raw = await res.json().catch(() => ({ statusText: res.statusText }));
  if (!res.ok) {
    throw new Error(
      `RunPod status failed (${res.status}): ${JSON.stringify(raw)}`,
    );
  }

  const body = raw as { status?: string; output?: unknown };
  return {
    mode: "live",
    externalRunId,
    status: normalizeRunPodStatus(body.status || "IN_PROGRESS"),
    output: body.output ?? null,
    raw,
  };
}

export function isRunPodMockMode(): boolean {
  return getConfig().mock;
}

export function getRunPodPublicConfig() {
  const { endpointId, apiBase, mock } = getConfig();
  return {
    mock,
    endpointIdConfigured: Boolean(endpointId),
    apiBase,
    workflowSource: process.env.RUNPOD_WORKFLOW_JSON?.trim()
      ? "env:RUNPOD_WORKFLOW_JSON"
      : process.env.RUNPOD_WORKFLOW_PATH?.trim()
        ? `file:${process.env.RUNPOD_WORKFLOW_PATH.trim()}`
        : "file:config/runpod-trellis-workflow.json",
  };
}
