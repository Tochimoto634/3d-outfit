/**
 * Shared (client + server) review helpers for generation jobs.
 * Keep this free of `.server` / Node-only imports so route components can use it.
 */

export type CollectedImage = {
  id: string;
  url: string;
  altText: string | null;
  position: number;
  source: "media" | "images";
  width?: number | null;
  height?: number | null;
};

export type CollectedMetafield = {
  namespace: string;
  key: string;
  type: string;
  value: string;
  description?: string | null;
};

export type ModelBodyMeta = {
  heightCm: number | null;
  weightKg: number | null;
  bustCm: number | null;
  waistCm: number | null;
  hipCm: number | null;
  sizeWorn: string | null;
  notes: string[];
  sourceKeys: string[];
};

export type MissingFlag =
  | "images"
  | "size_chart"
  | "model_meta"
  | "product_not_found"
  | "description";

export const MISSING_FLAG_LABELS: Record<MissingFlag, string> = {
  images: "写真なし（3D生成に必須）",
  size_chart: "サイズ表未解析（後工程のサイズ展開用・手動入力可）",
  model_meta: "モデル身長・体型メタなし（任意）",
  product_not_found: "商品が Admin API で見つかりませんでした",
  description: "商品説明が空です",
};

/** Max thumbnails rendered in the review gallery (avoids iframe hang). */
export const REVIEW_GALLERY_PREVIEW_LIMIT = 24;

export function missingFlagLabel(flag: string): string {
  return MISSING_FLAG_LABELS[flag as MissingFlag] || flag;
}

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function safeJsonArray<T>(raw: string): T[] {
  const parsed = safeJsonParse<unknown>(raw, []);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function readMetafieldsBlob(raw: string): {
  fields: CollectedMetafield[];
  modelMeta: ModelBodyMeta | null;
} {
  const parsed = safeJsonParse<unknown>(raw, []);
  if (Array.isArray(parsed)) {
    return {
      fields: parsed.filter(
        (item): item is CollectedMetafield =>
          Boolean(item) && typeof item === "object",
      ),
      modelMeta: null,
    };
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as {
      fields?: CollectedMetafield[];
      modelMeta?: ModelBodyMeta;
    };
    return {
      fields: Array.isArray(obj.fields)
        ? obj.fields.filter(
            (item): item is CollectedMetafield =>
              Boolean(item) && typeof item === "object",
          )
        : [],
      modelMeta: obj.modelMeta || null,
    };
  }
  return { fields: [], modelMeta: null };
}

export type SizeChartRowView = {
  size: string;
  measurements?: Record<string, number | string | null | undefined>;
};

export type SizeChartView = {
  rows: SizeChartRowView[];
  unit: string | null;
  incomplete?: boolean;
  notes?: string[];
  rawMatches?: unknown[];
  source?: string;
};

export function readSizeChartBlob(raw: string): SizeChartView {
  const parsed = safeJsonParse<unknown>(raw, null);
  if (!parsed || typeof parsed !== "object") {
    return {
      rows: [],
      unit: null,
      incomplete: true,
      notes: [],
      rawMatches: [],
      source: "none",
    };
  }
  const obj = parsed as Partial<SizeChartView>;
  return {
    rows: Array.isArray(obj.rows) ? obj.rows.filter(Boolean) : [],
    unit: typeof obj.unit === "string" ? obj.unit : null,
    incomplete: obj.incomplete !== false,
    notes: Array.isArray(obj.notes) ? obj.notes.map(String) : [],
    rawMatches: Array.isArray(obj.rawMatches) ? obj.rawMatches : [],
    source: typeof obj.source === "string" ? obj.source : "none",
  };
}
