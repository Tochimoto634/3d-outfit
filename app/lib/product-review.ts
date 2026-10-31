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

/** Japanese labels for size-chart measurement columns (operators). */
export const MEASUREMENT_LABELS_JA: Record<string, string> = {
  shoulder: "肩幅",
  bust: "身幅",
  chest: "胸囲",
  waist: "ウエスト",
  hip: "ヒップ",
  length: "着丈",
  sleeve: "袖丈",
  hem: "裾幅",
};

/** Default columns when no chart was parsed (editable blank table). */
export const DEFAULT_MEASUREMENT_KEYS = [
  "shoulder",
  "bust",
  "length",
  "sleeve",
] as const;

/** Default blank sizes for empty charts. */
export const DEFAULT_SIZE_LABELS = ["S", "M", "L"] as const;

export function measurementLabelJa(key: string): string {
  return MEASUREMENT_LABELS_JA[key] || key;
}

export function collectMeasurementKeys(
  rows: SizeChartRowView[],
  fallback: readonly string[] = DEFAULT_MEASUREMENT_KEYS,
): string[] {
  const keys = Array.from(
    new Set(rows.flatMap((r) => Object.keys(r?.measurements || {}))),
  );
  return keys.length > 0 ? keys : [...fallback];
}

/** Rows shown in the editable table (pad with defaults when empty). */
export function editableSizeChartRows(
  sizeChart: SizeChartView,
): SizeChartRowView[] {
  if (sizeChart.rows.length > 0) return sizeChart.rows;
  return DEFAULT_SIZE_LABELS.map((size) => ({
    size,
    measurements: Object.fromEntries(
      DEFAULT_MEASUREMENT_KEYS.map((k) => [k, ""]),
    ),
  }));
}

export type ManualEditsView = {
  reviewNotes?: string;
  sizeChartOverride?: string | null;
  modelMetaOverride?: Partial<ModelBodyMeta> | null;
  updatedAt?: string;
};

export function readManualEditsBlob(raw: string): ManualEditsView {
  const parsed = safeJsonParse<unknown>(raw, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as ManualEditsView;
}

/** Merge collected model meta with merchant override for display / form defaults. */
export function effectiveModelMeta(
  base: ModelBodyMeta | null,
  override?: Partial<ModelBodyMeta> | null,
): ModelBodyMeta {
  return {
    heightCm: override?.heightCm ?? base?.heightCm ?? null,
    weightKg: override?.weightKg ?? base?.weightKg ?? null,
    bustCm: override?.bustCm ?? base?.bustCm ?? null,
    waistCm: override?.waistCm ?? base?.waistCm ?? null,
    hipCm: override?.hipCm ?? base?.hipCm ?? null,
    sizeWorn: override?.sizeWorn ?? base?.sizeWorn ?? null,
    notes: base?.notes || [],
    sourceKeys: base?.sourceKeys || [],
  };
}

function parseOptionalNumber(raw: FormDataEntryValue | null): number | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build a size-chart JSON string from editable table form fields.
 * Expected names: sc_unit, sc_keys, sc_row_count, sc_size_{i}, sc_m_{i}_{key}
 */
export function sizeChartOverrideFromTableForm(form: FormData): string | null {
  const keysRaw = String(form.get("sc_keys") || "").trim();
  const keys = keysRaw
    ? keysRaw
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
    : [...DEFAULT_MEASUREMENT_KEYS];
  const rowCount = Math.max(
    0,
    Math.min(40, Number(form.get("sc_row_count") || 0) || 0),
  );
  const unitRaw = String(form.get("sc_unit") || "").trim();
  const unit =
    unitRaw === "cm" || unitRaw === "inch" ? unitRaw : unitRaw || null;

  const rows: SizeChartRowView[] = [];
  for (let i = 0; i < rowCount; i++) {
    const size = String(form.get(`sc_size_${i}`) || "").trim();
    if (!size) continue;
    const measurements: Record<string, number | null> = {};
    let hasAny = false;
    for (const key of keys) {
      const n = parseOptionalNumber(form.get(`sc_m_${i}_${key}`));
      measurements[key] = n;
      if (n != null) hasAny = true;
    }
    if (!hasAny && keys.every((k) => !String(form.get(`sc_m_${i}_${k}`) || "").trim())) {
      // Keep size-only rows so merchants can fill later
      for (const key of keys) measurements[key] = null;
    }
    rows.push({ size, measurements });
  }

  if (rows.length === 0) return null;

  return JSON.stringify(
    {
      unit,
      rows,
      notes: ["表形式UIから手動編集"],
    },
    null,
    2,
  );
}

/** Read model-body labeled fields from the review form. */
export function modelMetaOverrideFromForm(
  form: FormData,
): Partial<ModelBodyMeta> {
  return {
    heightCm: parseOptionalNumber(form.get("model_heightCm")),
    weightKg: parseOptionalNumber(form.get("model_weightKg")),
    bustCm: parseOptionalNumber(form.get("model_bustCm")),
    waistCm: parseOptionalNumber(form.get("model_waistCm")),
    hipCm: parseOptionalNumber(form.get("model_hipCm")),
    sizeWorn: String(form.get("model_sizeWorn") || "").trim() || null,
  };
}

export function sizeChartToEditorJson(sizeChart: SizeChartView): string {
  return JSON.stringify(
    {
      unit: sizeChart.unit,
      rows: sizeChart.rows,
      notes: sizeChart.notes,
    },
    null,
    2,
  );
}
