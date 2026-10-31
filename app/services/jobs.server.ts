import prisma from "../db.server";
import {
  applyManualEdits,
  buildCollectedSnapshot,
  PRODUCT_NODES_QUERY,
  productsMissingImages,
  type AdminProductNode,
  type ManualEditsPayload,
} from "./product-collect.server";
import { normalizeManualSizeChart } from "./size-chart.server";
import {
  extractAssetStubsFromOutput,
  getTrellisRunStatus,
  isRunPodMockMode,
  mapRunPodStatusToEngine,
  submitTrellisRun,
  type RunPodImageInput,
} from "./runpod.server";

export type SelectedProductRef = {
  id: string;
  title?: string | null;
};

/**
 * Normalize product IDs from Admin Link / Action query params.
 * Accepts GIDs or numeric IDs; returns Shopify Product GIDs.
 */
export function normalizeProductIds(raw: string[]): string[] {
  const out: string[] = [];
  for (const value of raw) {
    const v = value.trim();
    if (!v) continue;
    if (v.startsWith("gid://shopify/Product/")) {
      out.push(v);
      continue;
    }
    const numeric = v.replace(/^#/, "");
    if (/^\d+$/.test(numeric)) {
      out.push(`gid://shopify/Product/${numeric}`);
      continue;
    }
    // Already something else (variant etc.) — keep if it looks like a GID
    if (v.startsWith("gid://shopify/")) out.push(v);
  }
  return [...new Set(out)];
}

/**
 * Parse ids from a request URL search params.
 * Admin Link bulk selection appends repeated `ids[]=<numeric>`;
 * single-resource links often use `id=<numeric>`.
 */
export function productIdsFromSearchParams(
  searchParams: URLSearchParams,
): string[] {
  const collected: string[] = [];

  for (const key of ["ids", "id", "productIds", "product_ids", "ids[]", "id[]"]) {
    collected.push(...searchParams.getAll(key));
  }

  // Comma-separated values in a single param
  const expanded = collected.flatMap((v) => v.split(",").map((s) => s.trim()));
  return normalizeProductIds(expanded);
}

export async function ensureShop(shopDomain: string) {
  return prisma.shop.upsert({
    where: { shopDomain },
    create: { shopDomain },
    update: {},
  });
}

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/**
 * Create a GenerationJob and ProductSnapshots from selected product IDs.
 * Collection uses Admin GraphQL (media + images + metafields + description).
 */
export async function createGenerationJob(opts: {
  shopDomain: string;
  productIds: string[];
  admin: AdminGraphql;
}) {
  const productIds = normalizeProductIds(opts.productIds);
  if (productIds.length === 0) {
    throw new Error("商品が選択されていません");
  }

  const shop = await ensureShop(opts.shopDomain);

  const response = await opts.admin.graphql(PRODUCT_NODES_QUERY, {
    variables: { ids: productIds },
  });
  const json = (await response.json()) as {
    data?: {
      nodes?: Array<AdminProductNode | null>;
    };
    errors?: Array<{ message?: string }>;
  };

  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message || "GraphQL error").join("; ");
    throw new Error(`Shopify Admin API 収集エラー: ${msg}`);
  }

  const nodes = (json.data?.nodes || []).filter(Boolean) as AdminProductNode[];

  const job = await prisma.generationJob.create({
    data: {
      shopId: shop.id,
      status: "review",
      title: `3D作成 (${productIds.length}件)`,
      selectedProductIds: JSON.stringify(productIds),
      products: {
        create: productIds.map((gid) => {
          const node = nodes.find((n) => n?.id === gid);
          const collected = buildCollectedSnapshot({ gid, node });

          return {
            shopifyProductId: gid,
            handle: collected.handle,
            title: collected.title,
            descriptionHtml: collected.descriptionHtml,
            imagesJson: JSON.stringify(collected.images),
            metafieldsJson: JSON.stringify({
              fields: collected.metafields,
              modelMeta: collected.modelMeta,
            }),
            sizeChartJson: JSON.stringify(collected.sizeChart),
            manualEditsJson: "{}",
            missingFlagsJson: JSON.stringify(collected.missing),
          };
        }),
      },
    },
    include: { products: true },
  });

  return job;
}

export async function getGenerationJob(jobId: string) {
  return prisma.generationJob.findUnique({
    where: { id: jobId },
    include: {
      products: {
        orderBy: { createdAt: "asc" },
        include: { assets: { orderBy: { createdAt: "desc" } } },
      },
      engineRuns: { orderBy: { createdAt: "desc" }, include: { assets: true } },
      shop: true,
    },
  });
}

function readProductSnapshotId(requestJson: string): string | null {
  try {
    const parsed = JSON.parse(requestJson) as { productSnapshotId?: string };
    return parsed.productSnapshotId || null;
  } catch {
    return null;
  }
}

async function upsertAssetStubs(opts: {
  engineRunId: string;
  productSnapshotId: string;
  output: unknown;
  mock: boolean;
}) {
  const stubs = extractAssetStubsFromOutput(opts.output);
  if (stubs.length === 0 && opts.mock) {
    // Persist an explicit stub row so UI can show "awaiting real GLB"
    await prisma.asset3D.create({
      data: {
        productSnapshotId: opts.productSnapshotId,
        engineRunId: opts.engineRunId,
        kind: "base",
        sizeLabel: "worn",
        storageUrl: null,
        mimeType: "model/gltf-binary",
        metaJson: JSON.stringify({
          stub: true,
          mock: true,
          note: "Mock EngineRun — no GLB URL. Live RunPod output URLs land here.",
        }),
      },
    });
    return 1;
  }

  let created = 0;
  for (const stub of stubs) {
    const existing = await prisma.asset3D.findFirst({
      where: {
        engineRunId: opts.engineRunId,
        storageUrl: stub.url,
      },
    });
    if (existing) continue;
    await prisma.asset3D.create({
      data: {
        productSnapshotId: opts.productSnapshotId,
        engineRunId: opts.engineRunId,
        kind: stub.kind,
        sizeLabel: stub.kind === "base" ? "worn" : stub.label || null,
        storageUrl: stub.url,
        mimeType: stub.mimeType,
        metaJson: JSON.stringify({
          stub: false,
          source: "runpod_output",
          label: stub.label || null,
        }),
      },
    });
    created += 1;
  }
  return created;
}

export class GenerationBlockedError extends Error {
  readonly code = "IMAGES_REQUIRED";
  readonly productTitles: string[];

  constructor(productTitles: string[]) {
    super(
      `写真がない商品があるため作成を開始できません: ${productTitles.join(", ")}`,
    );
    this.name = "GenerationBlockedError";
    this.productTitles = productTitles;
  }
}

/**
 * Confirm review and kick off RunPod (mock or live) for each product snapshot.
 * Generation uses photos only — size chart is ignored here by design.
 * Blocks when any product has zero images (required for TRELLIS photo input).
 */
/** Statuses that may kick off (or re-kick) generation from the review UI. */
const STARTABLE_JOB_STATUSES = new Set([
  "review",
  "collecting",
  "failed",
  "cancelled",
]);

export async function confirmAndStartGeneration(jobId: string) {
  const job = await getGenerationJob(jobId);
  if (!job) throw new Error("Job not found");
  if (!STARTABLE_JOB_STATUSES.has(job.status)) {
    throw new Error(
      `Job status ${job.status} cannot start generation（作成進行中／作成済みのジョブは再開始できません）`,
    );
  }

  const missingPhotoTitles = productsMissingImages(
    job.products.map((p) => ({
      missingFlagsJson: p.missingFlagsJson,
      imagesJson: p.imagesJson,
      title: p.title,
      shopifyProductId: p.shopifyProductId,
    })),
  );
  if (missingPhotoTitles.length > 0) {
    throw new GenerationBlockedError(missingPhotoTitles);
  }

  const updated = await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "generating",
      confirmedAt: new Date(),
      startedAt: new Date(),
      errorMessage: null,
    },
  });

  const runs = [];
  for (const product of job.products) {
    const images = JSON.parse(product.imagesJson) as Array<{
      url: string;
      altText?: string | null;
    }>;
    const imageInputs: RunPodImageInput[] = images.map((img) => ({
      url: img.url,
      alt: img.altText || undefined,
    }));

    if (imageInputs.length === 0) {
      throw new GenerationBlockedError([
        product.title || product.shopifyProductId,
      ]);
    }

    const engineRun = await prisma.engineRun.create({
      data: {
        jobId,
        status: "queued",
        photoOnly: true,
        endpointId: process.env.RUNPOD_ENDPOINT_ID || null,
        requestJson: JSON.stringify({
          productSnapshotId: product.id,
          shopifyProductId: product.shopifyProductId,
          imageCount: imageInputs.length,
          // Size chart intentionally omitted from generation payload
          photoOnly: true,
          mock: isRunPodMockMode(),
        }),
      },
    });

    try {
      const result = await submitTrellisRun({
        productSnapshotId: product.id,
        images: imageInputs,
        meta: {
          shopifyProductId: product.shopifyProductId,
          // Size chart intentionally omitted
        },
      });

      const mapped = mapRunPodStatusToEngine(result.status);
      const saved = await prisma.engineRun.update({
        where: { id: engineRun.id },
        data: {
          status: mapped === "succeeded" ? "submitted" : mapped,
          externalRunId: result.externalRunId,
          endpointId: result.endpointId,
          responseJson: JSON.stringify({
            submit: result.raw,
            mode: result.mode,
          }),
          startedAt: new Date(),
        },
      });
      runs.push(saved);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = await prisma.engineRun.update({
        where: { id: engineRun.id },
        data: {
          status: "failed",
          errorMessage: message,
          finishedAt: new Date(),
        },
      });
      runs.push(failed);
    }
  }

  const anyFailed = runs.some((r) => r.status === "failed");
  if (anyFailed && runs.every((r) => r.status === "failed")) {
    await prisma.generationJob.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: "All engine runs failed" },
    });
  }

  return { job: updated, runs, mock: isRunPodMockMode() };
}

const TERMINAL_ENGINE = new Set(["succeeded", "failed", "cancelled"]);

/**
 * Poll RunPod for open EngineRuns, map statuses, store asset URL stubs,
 * and roll up GenerationJob status (generating → ready / failed).
 */
export async function pollAndSyncEngineRuns(jobId: string) {
  const job = await getGenerationJob(jobId);
  if (!job) throw new Error("Job not found");

  const updates = [];
  for (const run of job.engineRuns) {
    if (!run.externalRunId) continue;
    if (TERMINAL_ENGINE.has(run.status) && run.status !== "succeeded") {
      // failed/cancelled stay put; succeeded may still need asset upsert once
      continue;
    }
    if (run.status === "succeeded" && run.assets.length > 0) continue;

    try {
      const status = await getTrellisRunStatus(run.externalRunId);
      const mapped = mapRunPodStatusToEngine(status.status);
      const productSnapshotId = readProductSnapshotId(run.requestJson);

      let responseJson = run.responseJson;
      try {
        const prev = JSON.parse(run.responseJson || "{}") as Record<
          string,
          unknown
        >;
        responseJson = JSON.stringify({
          ...prev,
          latest: status.raw,
          mode: status.mode,
          polledAt: new Date().toISOString(),
        });
      } catch {
        responseJson = JSON.stringify({ latest: status.raw });
      }

      const data: {
        status: typeof mapped;
        responseJson: string;
        finishedAt?: Date | null;
        errorMessage?: string | null;
      } = {
        status: mapped,
        responseJson,
      };

      if (TERMINAL_ENGINE.has(mapped)) {
        data.finishedAt = new Date();
      }
      if (mapped === "failed") {
        data.errorMessage =
          typeof status.output === "object" &&
          status.output &&
          "error" in (status.output as object)
            ? String((status.output as { error?: unknown }).error)
            : "RunPod reported FAILED";
      }

      const saved = await prisma.engineRun.update({
        where: { id: run.id },
        data,
      });

      let assetsCreated = 0;
      if (mapped === "succeeded" && productSnapshotId) {
        assetsCreated = await upsertAssetStubs({
          engineRunId: run.id,
          productSnapshotId,
          output: status.output,
          mock: status.mode === "mock",
        });
      }

      updates.push({
        id: saved.id,
        status: saved.status,
        externalRunId: saved.externalRunId,
        assetsCreated,
        mode: status.mode,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = await prisma.engineRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          errorMessage: message,
          finishedAt: new Date(),
        },
      });
      updates.push({
        id: failed.id,
        status: failed.status,
        externalRunId: failed.externalRunId,
        assetsCreated: 0,
        mode: "error" as const,
      });
    }
  }

  const refreshed = await getGenerationJob(jobId);
  if (!refreshed) throw new Error("Job not found after poll");

  const statuses = refreshed.engineRuns.map((r) => r.status);
  let nextStatus = refreshed.status;
  let errorMessage = refreshed.errorMessage;

  if (statuses.length > 0 && statuses.every((s) => TERMINAL_ENGINE.has(s))) {
    if (statuses.every((s) => s === "failed" || s === "cancelled")) {
      nextStatus = "failed";
      errorMessage = errorMessage || "All engine runs failed or cancelled";
    } else {
      // Base worn-size assets ready; S/M/L sizing is a later phase
      nextStatus = "ready";
      errorMessage = null;
    }
  } else if (statuses.some((s) => s === "running" || s === "submitted" || s === "queued")) {
    nextStatus = "generating";
  }

  const jobUpdated = await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: nextStatus,
      errorMessage,
      completedAt:
        nextStatus === "ready" || nextStatus === "failed"
          ? new Date()
          : refreshed.completedAt,
    },
  });

  return {
    job: jobUpdated,
    updates,
    mock: isRunPodMockMode(),
  };
}

/**
 * Persist merchant manual edits and refresh missing flags / size chart
 * when a structured override is provided.
 */
export async function updateProductManualEdits(
  snapshotId: string,
  manualEdits: ManualEditsPayload & Record<string, unknown>,
) {
  const existing = await prisma.productSnapshot.findUnique({
    where: { id: snapshotId },
  });
  if (!existing) throw new Error("Product snapshot not found");

  let prev: ManualEditsPayload = {};
  try {
    prev = JSON.parse(existing.manualEditsJson || "{}") as ManualEditsPayload;
  } catch {
    prev = {};
  }

  const merged: ManualEditsPayload = {
    ...prev,
    ...manualEdits,
    // Preserve prior model meta when the body section was hidden on save.
    modelMetaOverride:
      manualEdits.modelMetaOverride === null ||
      manualEdits.modelMetaOverride === undefined
        ? prev.modelMetaOverride ?? null
        : manualEdits.modelMetaOverride,
    hasModelPhotoOverride:
      typeof manualEdits.hasModelPhotoOverride === "boolean"
        ? manualEdits.hasModelPhotoOverride
        : (prev.hasModelPhotoOverride ?? null),
    updatedAt: new Date().toISOString(),
  };

  let sizeChartJson = existing.sizeChartJson;
  let parsedChart = null as ReturnType<typeof normalizeManualSizeChart>;
  if (merged.sizeChartOverride) {
    parsedChart = normalizeManualSizeChart(merged.sizeChartOverride);
    if (parsedChart && parsedChart.rows.length > 0) {
      merged.sizeChartJson = parsedChart;
      sizeChartJson = JSON.stringify(parsedChart);
    }
  }

  let images: unknown[] = [];
  try {
    images = JSON.parse(existing.imagesJson) as unknown[];
  } catch {
    images = [];
  }

  let metafieldsBlob: {
    fields?: unknown[];
    modelMeta?: ManualEditsPayload["modelMetaOverride"];
  } = {};
  try {
    metafieldsBlob = JSON.parse(existing.metafieldsJson || "{}") as typeof metafieldsBlob;
  } catch {
    metafieldsBlob = {};
  }

  if (merged.modelMetaOverride) {
    const prevMeta = metafieldsBlob.modelMeta || {};
    const nextSourceKeys = [
      ...(prevMeta.sourceKeys || []),
      "manual_override",
    ].filter((v, i, arr) => arr.indexOf(v) === i);
    metafieldsBlob = {
      ...metafieldsBlob,
      fields: Array.isArray(metafieldsBlob.fields) ? metafieldsBlob.fields : [],
      modelMeta: {
        heightCm:
          merged.modelMetaOverride.heightCm ?? prevMeta.heightCm ?? null,
        weightKg:
          merged.modelMetaOverride.weightKg ?? prevMeta.weightKg ?? null,
        bustCm: merged.modelMetaOverride.bustCm ?? prevMeta.bustCm ?? null,
        waistCm: merged.modelMetaOverride.waistCm ?? prevMeta.waistCm ?? null,
        hipCm: merged.modelMetaOverride.hipCm ?? prevMeta.hipCm ?? null,
        sizeWorn:
          merged.modelMetaOverride.sizeWorn ?? prevMeta.sizeWorn ?? null,
        notes: prevMeta.notes || [],
        sourceKeys: nextSourceKeys,
      },
    };
  }

  let baseChart;
  try {
    baseChart = JSON.parse(existing.sizeChartJson) as Parameters<
      typeof applyManualEdits
    >[0]["sizeChart"];
  } catch {
    baseChart = {
      rows: [],
      unit: null,
      incomplete: true,
      notes: [],
      rawMatches: [],
      source: "none" as const,
    };
  }

  const effective = applyManualEdits({
    images: images as Parameters<typeof applyManualEdits>[0]["images"],
    sizeChart: parsedChart?.rows.length ? parsedChart : baseChart,
    modelMeta: {
      heightCm: null,
      weightKg: null,
      bustCm: null,
      waistCm: null,
      hipCm: null,
      sizeWorn: null,
      notes: [],
      sourceKeys: [],
      ...(metafieldsBlob.modelMeta || {}),
    },
    descriptionHtml: existing.descriptionHtml,
    productFound: !JSON.parse(existing.missingFlagsJson || "[]").includes(
      "product_not_found",
    ),
    manualEdits: merged,
  });

  return prisma.productSnapshot.update({
    where: { id: snapshotId },
    data: {
      manualEditsJson: JSON.stringify(merged),
      sizeChartJson,
      metafieldsJson: JSON.stringify(metafieldsBlob),
      missingFlagsJson: JSON.stringify(effective.missing),
      reviewNotes:
        typeof merged.reviewNotes === "string" ? merged.reviewNotes : existing.reviewNotes,
    },
  });
}

/** Summarize job-level blockers for the review UI. */
export function getJobStartBlockers(
  products: Array<{
    title: string | null;
    shopifyProductId: string;
    missingFlagsJson: string;
    imagesJson: string;
  }>,
) {
  const missingImages = productsMissingImages(products);
  const softWarnings: string[] = [];
  for (const p of products) {
    let flags: string[] = [];
    try {
      const parsed = JSON.parse(p.missingFlagsJson) as unknown;
      flags = Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      flags = [];
    }
    const label = p.title || p.shopifyProductId;
    if (flags.includes("size_chart")) {
      softWarnings.push(`${label}: サイズ表未解析（後工程用・作成は可能）`);
    }
    if (flags.includes("model_meta")) {
      softWarnings.push(
        `${label}: モデル体型メタなし（着用モデル写真あり・任意／作成は可能）`,
      );
    }
  }
  return {
    blocked: missingImages.length > 0,
    missingImages,
    softWarnings,
  };
}
