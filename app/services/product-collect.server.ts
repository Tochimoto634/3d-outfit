/**
 * Shopify Admin API product collection helpers for 3D OUTFIT review.
 * Collects all product images, description HTML, and metafields
 * (including model height / body when present).
 */

import {
  MISSING_FLAG_LABELS,
  type CollectedImage,
  type CollectedMetafield,
  type MissingFlag,
  type ModelBodyMeta,
} from "../lib/product-review";
import {
  normalizeManualSizeChart,
  parseSizeChart,
  type SizeChartParseResult,
} from "./size-chart.server";

export type {
  CollectedImage,
  CollectedMetafield,
  MissingFlag,
  ModelBodyMeta,
} from "../lib/product-review";
export { MISSING_FLAG_LABELS } from "../lib/product-review";

export const PRODUCT_NODES_QUERY = `#graphql
  query ProductNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
        descriptionHtml
        featuredMedia {
          ... on MediaImage {
            id
            image {
              url
              altText
              width
              height
            }
          }
        }
        media(first: 100) {
          nodes {
            ... on MediaImage {
              id
              image {
                url
                altText
                width
                height
              }
            }
          }
        }
        images(first: 100) {
          nodes {
            id
            url
            altText
            width
            height
          }
        }
        metafields(first: 100) {
          nodes {
            namespace
            key
            type
            value
            description
          }
        }
      }
    }
  }
`;

export type AdminProductNode = {
  id?: string;
  title?: string;
  handle?: string;
  descriptionHtml?: string | null;
  featuredMedia?: {
    id?: string;
    image?: {
      url?: string;
      altText?: string | null;
      width?: number | null;
      height?: number | null;
    } | null;
  } | null;
  media?: {
    nodes: Array<{
      id?: string;
      image?: {
        url?: string;
        altText?: string | null;
        width?: number | null;
        height?: number | null;
      } | null;
    } | null>;
  };
  images?: {
    nodes: Array<{
      id: string;
      url: string;
      altText?: string | null;
      width?: number | null;
      height?: number | null;
    }>;
  };
  metafields?: {
    nodes: Array<{
      namespace: string;
      key: string;
      type: string;
      value: string;
      description?: string | null;
    }>;
  };
};

const MODEL_KEY_HINTS = [
  "model",
  "モデル",
  "身長",
  "height",
  "body",
  "体型",
  "着用",
  "worn",
  "size_worn",
  "modelsize",
  "model_size",
  "modelheight",
  "model_height",
  "weight",
  "体重",
  "bust",
  "waist",
  "hip",
  "スリーサイズ",
];

function parseNumericLoose(raw: string): number | null {
  const m = String(raw)
    .replace(/,/g, "")
    .match(/(\d{2,3}(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function metafieldFullKey(mf: CollectedMetafield): string {
  return `${mf.namespace}.${mf.key}`.toLowerCase();
}

function looksLikeModelMetafield(mf: CollectedMetafield): boolean {
  const blob = `${mf.namespace} ${mf.key} ${mf.description || ""}`.toLowerCase();
  return MODEL_KEY_HINTS.some((h) => blob.includes(h.toLowerCase()));
}

/**
 * Merge media + legacy images into a de-duplicated gallery (by URL).
 */
export function collectProductImages(node: AdminProductNode | null | undefined): CollectedImage[] {
  const byUrl = new Map<string, CollectedImage>();
  let position = 0;

  const push = (
    id: string,
    url: string | undefined | null,
    altText: string | null | undefined,
    source: CollectedImage["source"],
    width?: number | null,
    height?: number | null,
  ) => {
    if (!url?.trim()) return;
    const key = url.trim();
    if (byUrl.has(key)) return;
    position += 1;
    byUrl.set(key, {
      id: id || key,
      url: key,
      altText: altText ?? null,
      position,
      source,
      width: width ?? null,
      height: height ?? null,
    });
  };

  const featured = node?.featuredMedia?.image;
  if (featured?.url) {
    push(
      node?.featuredMedia?.id || featured.url,
      featured.url,
      featured.altText,
      "media",
      featured.width,
      featured.height,
    );
  }

  for (const m of node?.media?.nodes || []) {
    if (!m?.image?.url) continue;
    push(
      m.id || m.image.url,
      m.image.url,
      m.image.altText,
      "media",
      m.image.width,
      m.image.height,
    );
  }

  for (const img of node?.images?.nodes || []) {
    push(img.id, img.url, img.altText, "images", img.width, img.height);
  }

  return [...byUrl.values()].sort((a, b) => a.position - b.position);
}

export function collectMetafields(
  node: AdminProductNode | null | undefined,
): CollectedMetafield[] {
  return (node?.metafields?.nodes || []).map((mf) => ({
    namespace: mf.namespace,
    key: mf.key,
    type: mf.type,
    value: mf.value,
    description: mf.description ?? null,
  }));
}

/**
 * Best-effort extract of model height / body from metafields (JP/EN keys).
 */
export function extractModelBodyMeta(
  metafields: CollectedMetafield[],
): ModelBodyMeta {
  const result: ModelBodyMeta = {
    heightCm: null,
    weightKg: null,
    bustCm: null,
    waistCm: null,
    hipCm: null,
    sizeWorn: null,
    notes: [],
    sourceKeys: [],
  };

  const candidates = metafields.filter(looksLikeModelMetafield);
  if (candidates.length === 0) {
    result.notes.push("モデル身長・体型のメタフィールド候補なし");
    return result;
  }

  for (const mf of candidates) {
    const full = metafieldFullKey(mf);
    const keyBlob = `${mf.key} ${mf.description || ""}`.toLowerCase();
    const value = mf.value;
    result.sourceKeys.push(`${mf.namespace}.${mf.key}`);

    if (
      result.heightCm == null &&
      /(height|身長|model_?height|モデル身長)/i.test(keyBlob + full)
    ) {
      result.heightCm = parseNumericLoose(value);
    } else if (
      result.weightKg == null &&
      /(weight|体重)/i.test(keyBlob + full)
    ) {
      result.weightKg = parseNumericLoose(value);
    } else if (
      result.bustCm == null &&
      /(bust|バスト|胸囲)/i.test(keyBlob + full)
    ) {
      result.bustCm = parseNumericLoose(value);
    } else if (
      result.waistCm == null &&
      /(waist|ウエスト|ウェスト)/i.test(keyBlob + full)
    ) {
      result.waistCm = parseNumericLoose(value);
    } else if (
      result.hipCm == null &&
      /(hip|ヒップ)/i.test(keyBlob + full)
    ) {
      result.hipCm = parseNumericLoose(value);
    } else if (
      result.sizeWorn == null &&
      /(worn|着用|size_worn|modelsize|model_size|着用サイズ)/i.test(
        keyBlob + full,
      )
    ) {
      result.sizeWorn = value.trim().slice(0, 32) || null;
    } else if (
      // JSON blob metafields
      (mf.type.includes("json") || value.trim().startsWith("{")) &&
      result.heightCm == null
    ) {
      try {
        const obj = JSON.parse(value) as Record<string, unknown>;
        for (const [k, v] of Object.entries(obj)) {
          const lk = k.toLowerCase();
          const num =
            typeof v === "number"
              ? v
              : typeof v === "string"
                ? parseNumericLoose(v)
                : null;
          if (num == null && typeof v !== "string") continue;
          if (result.heightCm == null && /(height|身長)/i.test(lk)) {
            result.heightCm = num;
          } else if (result.weightKg == null && /(weight|体重)/i.test(lk)) {
            result.weightKg = num;
          } else if (result.bustCm == null && /(bust|バスト)/i.test(lk)) {
            result.bustCm = num;
          } else if (result.waistCm == null && /(waist|ウエスト)/i.test(lk)) {
            result.waistCm = num;
          } else if (result.hipCm == null && /(hip|ヒップ)/i.test(lk)) {
            result.hipCm = num;
          } else if (
            result.sizeWorn == null &&
            /(worn|size|サイズ)/i.test(lk) &&
            typeof v === "string"
          ) {
            result.sizeWorn = v.trim().slice(0, 32);
          }
        }
      } catch {
        // ignore non-JSON
      }
    }
  }

  if (
    result.heightCm == null &&
    result.weightKg == null &&
    result.bustCm == null &&
    !result.sizeWorn
  ) {
    result.notes.push(
      "モデル関連メタフィールドはあるが身長・体型数値を抽出できませんでした",
    );
  }

  return result;
}

export function hasUsableModelMeta(meta: ModelBodyMeta): boolean {
  return (
    meta.heightCm != null ||
    meta.weightKg != null ||
    meta.bustCm != null ||
    meta.waistCm != null ||
    meta.hipCm != null ||
    Boolean(meta.sizeWorn)
  );
}

export type EffectiveProductReview = {
  images: CollectedImage[];
  sizeChart: SizeChartParseResult;
  metafields: CollectedMetafield[];
  modelMeta: ModelBodyMeta;
  missing: MissingFlag[];
  missingLabels: Record<MissingFlag, string>;
};

/**
 * Compute missing flags for a product snapshot (photos required for 3D).
 */
export function computeMissingFlags(opts: {
  productFound: boolean;
  images: CollectedImage[];
  descriptionHtml?: string | null;
  sizeChart: SizeChartParseResult;
  modelMeta: ModelBodyMeta;
}): MissingFlag[] {
  const missing: MissingFlag[] = [];
  if (!opts.productFound) {
    missing.push("product_not_found");
    return missing;
  }
  if (opts.images.length === 0) missing.push("images");
  if (!opts.descriptionHtml?.trim()) missing.push("description");
  if (opts.sizeChart.incomplete || opts.sizeChart.rows.length === 0) {
    missing.push("size_chart");
  }
  if (!hasUsableModelMeta(opts.modelMeta)) missing.push("model_meta");
  return missing;
}

export function buildCollectedSnapshot(opts: {
  gid: string;
  node: AdminProductNode | null | undefined;
}) {
  const node = opts.node;
  const images = collectProductImages(node);
  const metafields = collectMetafields(node);
  const modelMeta = extractModelBodyMeta(metafields);
  const sizeChart = parseSizeChart(node?.descriptionHtml);
  const missing = computeMissingFlags({
    productFound: Boolean(node?.id),
    images,
    descriptionHtml: node?.descriptionHtml,
    sizeChart,
    modelMeta,
  });

  return {
    shopifyProductId: opts.gid,
    handle: node?.handle ?? null,
    title: node?.title ?? opts.gid,
    descriptionHtml: node?.descriptionHtml ?? null,
    images,
    metafields,
    sizeChart,
    modelMeta,
    missing,
  };
}

export type ManualEditsPayload = {
  reviewNotes?: string;
  sizeChartOverride?: string | null;
  sizeChartJson?: SizeChartParseResult | null;
  modelMetaOverride?: Partial<ModelBodyMeta> | null;
  updatedAt?: string;
};

/**
 * Apply manual edits over collected data for review display / start checks.
 */
export function applyManualEdits(opts: {
  images: CollectedImage[];
  sizeChart: SizeChartParseResult;
  modelMeta: ModelBodyMeta;
  descriptionHtml?: string | null;
  productFound: boolean;
  manualEdits: ManualEditsPayload;
}): EffectiveProductReview {
  let sizeChart = opts.sizeChart;
  const overrideRaw =
    opts.manualEdits.sizeChartJson ||
    opts.manualEdits.sizeChartOverride ||
    null;
  if (overrideRaw) {
    const normalized = normalizeManualSizeChart(overrideRaw);
    if (normalized && normalized.rows.length > 0) {
      sizeChart = normalized;
    } else if (normalized) {
      sizeChart = {
        ...sizeChart,
        notes: [...sizeChart.notes, ...normalized.notes],
      };
    }
  }

  const modelMeta: ModelBodyMeta = {
    ...opts.modelMeta,
    ...(opts.manualEdits.modelMetaOverride || {}),
    notes: opts.modelMeta.notes,
    sourceKeys: opts.modelMeta.sourceKeys,
  };

  const missing = computeMissingFlags({
    productFound: opts.productFound,
    images: opts.images,
    descriptionHtml: opts.descriptionHtml,
    sizeChart,
    modelMeta,
  });

  return {
    images: opts.images,
    sizeChart,
    metafields: [],
    modelMeta,
    missing,
    missingLabels: MISSING_FLAG_LABELS,
  };
}

/** Titles (or IDs) of products missing photos required for 3D generation. */
export function productsMissingImages(
  products: Array<{
    missingFlagsJson: string;
    imagesJson: string;
    title?: string | null;
    shopifyProductId?: string;
  }>,
): string[] {
  const blocked: string[] = [];
  for (const p of products) {
    let images: unknown[] = [];
    try {
      const parsed = JSON.parse(p.imagesJson) as unknown;
      images = Array.isArray(parsed) ? parsed : [];
    } catch {
      images = [];
    }
    let flags: string[] = [];
    try {
      const parsed = JSON.parse(p.missingFlagsJson) as unknown;
      flags = Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      flags = [];
    }
    if (images.length === 0 || flags.includes("images")) {
      blocked.push(p.title || p.shopifyProductId || "unknown");
    }
  }
  return blocked;
}
