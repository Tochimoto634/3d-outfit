import prisma from "../db.server";
import { parseSizeChart } from "./size-chart.server";
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

const PRODUCT_NODES_QUERY = `#graphql
  query ProductNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
        descriptionHtml
        images(first: 50) {
          nodes {
            id
            url
            altText
          }
        }
        metafields(first: 50) {
          nodes {
            namespace
            key
            type
            value
          }
        }
      }
    }
  }
`;

/**
 * Create a GenerationJob and ProductSnapshots from selected product IDs.
 * Collection uses Admin GraphQL; size chart via stub parser.
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
      nodes?: Array<{
        id?: string;
        title?: string;
        handle?: string;
        descriptionHtml?: string;
        images?: { nodes: Array<{ id: string; url: string; altText?: string }> };
        metafields?: {
          nodes: Array<{
            namespace: string;
            key: string;
            type: string;
            value: string;
          }>;
        };
      } | null>;
    };
  };

  const nodes = (json.data?.nodes || []).filter(Boolean);

  const job = await prisma.generationJob.create({
    data: {
      shopId: shop.id,
      status: "review",
      title: `3D作成 (${productIds.length}件)`,
      selectedProductIds: JSON.stringify(productIds),
      products: {
        create: productIds.map((gid) => {
          const node = nodes.find((n) => n?.id === gid);
          const images = node?.images?.nodes || [];
          const metafields = node?.metafields?.nodes || [];
          const sizeChart = parseSizeChart(node?.descriptionHtml);
          const missing: string[] = [];
          if (images.length === 0) missing.push("images");
          if (sizeChart.incomplete) missing.push("size_chart");
          if (metafields.length === 0) missing.push("metafields");
          if (!node) missing.push("product_not_found");

          return {
            shopifyProductId: gid,
            handle: node?.handle ?? null,
            title: node?.title ?? gid,
            descriptionHtml: node?.descriptionHtml ?? null,
            imagesJson: JSON.stringify(images),
            metafieldsJson: JSON.stringify(metafields),
            sizeChartJson: JSON.stringify(sizeChart),
            manualEditsJson: "{}",
            missingFlagsJson: JSON.stringify(missing),
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

/**
 * Confirm review and kick off RunPod (mock or live) for each product snapshot.
 * Generation uses photos only — size chart is ignored here by design.
 */
export async function confirmAndStartGeneration(jobId: string) {
  const job = await getGenerationJob(jobId);
  if (!job) throw new Error("Job not found");
  if (job.status !== "review" && job.status !== "collecting") {
    throw new Error(`Job status ${job.status} cannot start generation`);
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
      altText?: string;
    }>;
    const imageInputs: RunPodImageInput[] = images.map((img) => ({
      url: img.url,
      alt: img.altText,
    }));

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
        images: imageInputs.length
          ? imageInputs
          : [{ url: "https://example.invalid/missing.jpg", alt: "placeholder" }],
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

export async function updateProductManualEdits(
  snapshotId: string,
  manualEdits: Record<string, unknown>,
) {
  return prisma.productSnapshot.update({
    where: { id: snapshotId },
    data: { manualEditsJson: JSON.stringify(manualEdits) },
  });
}
