import prisma from "../db.server";
import { parseSizeChart } from "./size-chart.server";
import {
  isRunPodMockMode,
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
 * Parse ids from a request URL search params (Admin Link appends resource ids).
 */
export function productIdsFromSearchParams(
  searchParams: URLSearchParams,
): string[] {
  const collected: string[] = [];

  for (const key of ["ids", "id", "productIds", "product_ids"]) {
    collected.push(...searchParams.getAll(key));
  }
  // ids[] style
  collected.push(...searchParams.getAll("ids[]"));

  // Comma-separated
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
      products: { orderBy: { createdAt: "asc" } },
      engineRuns: { orderBy: { createdAt: "desc" } },
      shop: true,
    },
  });
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
          imageCount: imageInputs.length,
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

      const saved = await prisma.engineRun.update({
        where: { id: engineRun.id },
        data: {
          status: "submitted",
          externalRunId: result.externalRunId,
          endpointId: result.endpointId,
          responseJson: JSON.stringify(result.raw),
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

export async function updateProductManualEdits(
  snapshotId: string,
  manualEdits: Record<string, unknown>,
) {
  return prisma.productSnapshot.update({
    where: { id: snapshotId },
    data: { manualEditsJson: JSON.stringify(manualEdits) },
  });
}
