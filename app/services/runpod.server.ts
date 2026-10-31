/**
 * RunPod client skeleton for ComfyUI / TRELLIS.2 workflows.
 *
 * Env:
 * - RUNPOD_API_KEY          (required for live calls; mock mode if missing)
 * - RUNPOD_ENDPOINT_ID      (serverless endpoint id)
 * - RUNPOD_API_BASE         (optional, default https://api.runpod.ai/v2)
 *
 * Constraint: 3D generation uses photos only — never send size-chart data.
 */

export type RunPodImageInput = {
  url: string;
  alt?: string | null;
};

export type TrellisWorkflowInput = {
  /** Product / snapshot identifier for tracing */
  productSnapshotId: string;
  /** Photo URLs only — size chart must NOT be included */
  images: RunPodImageInput[];
  /** Optional ComfyUI workflow graph JSON (stub-friendly) */
  workflow?: Record<string, unknown>;
  /** Extra non-secret metadata */
  meta?: Record<string, unknown>;
};

export type RunPodSubmitResult = {
  mode: "live" | "mock";
  endpointId: string | null;
  externalRunId: string;
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";
  raw: unknown;
};

export type RunPodStatusResult = {
  mode: "live" | "mock";
  externalRunId: string;
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";
  output: unknown;
  raw: unknown;
};

function getConfig() {
  const apiKey = process.env.RUNPOD_API_KEY?.trim() || "";
  const endpointId = process.env.RUNPOD_ENDPOINT_ID?.trim() || "";
  const apiBase =
    process.env.RUNPOD_API_BASE?.trim() || "https://api.runpod.ai/v2";
  return { apiKey, endpointId, apiBase, mock: !apiKey };
}

/**
 * Build the HTTP payload shape for a TRELLIS / ComfyUI run.
 * Intentionally omits any size-chart fields.
 */
export function buildTrellisRunPayload(input: TrellisWorkflowInput) {
  if (!input.images.length) {
    throw new Error("TRELLIS run requires at least one product image");
  }

  return {
    input: {
      // Photo-only generation (size chart excluded by design)
      photo_only: true as const,
      product_snapshot_id: input.productSnapshotId,
      images: input.images.map((img) => ({
        url: img.url,
        alt: img.alt ?? null,
      })),
      // Full ComfyUI graph wiring is Phase 3 — placeholder workflow hook
      workflow: input.workflow ?? {
        _todo: "Wire ComfyUI + TRELLIS.2 graph here",
        nodes: [],
      },
      meta: input.meta ?? {},
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
        payload,
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
    status: (body.status as RunPodSubmitResult["status"]) || "IN_QUEUE",
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
        asset_url: null,
        message: "Mock run completed — no GLB produced",
      },
      raw: { mock: true },
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
    status: (body.status as RunPodStatusResult["status"]) || "IN_PROGRESS",
    output: body.output ?? null,
    raw,
  };
}

export function isRunPodMockMode(): boolean {
  return getConfig().mock;
}
