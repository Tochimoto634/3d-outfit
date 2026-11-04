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
  /** Optional tagged media role from Shopify / collection metadata. */
  mediaRole?: string | null;
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
  size_chart:
    "サイズ表記なし（サイズ表が必要・表に入力して保存してください）",
  /** Legacy flag; Admin no longer gates or soft-warns on model body meta. */
  model_meta: "モデル身長・体型メタなし（任意・現行レビューでは未使用）",
  product_not_found: "商品が Admin API で見つかりませんでした",
  description: "商品説明が空です",
};

/** Helper copy under the Admin single-image gallery picker. */
export const REVIEW_SELECTED_IMAGE_HELPER =
  "3Dモデルを作成するのに使用するため全体が分かりやすいものを選択。";

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
  /** @deprecated Admin body-field path removed; retained for old JSON only. */
  modelMetaOverride?: Partial<ModelBodyMeta> | null;
  /** @deprecated Admin「着用モデル写真」override removed; retained for old JSON only. */
  hasModelPhotoOverride?: boolean | null;
  /**
   * Image id (or url fallback) chosen for TRELLIS / RunPod input.
   * When omitted, create/start uses the first gallery image.
   */
  selectedImageId?: string | null;
  /**
   * Operator-confirmed Grounding/SAM2 text (セグメンテーション用プロンプト).
   * When omitted, Admin UI / submit fall back to normalizeProductTitlePrompt(title).
   */
  productTitlePrompt?: string | null;
  updatedAt?: string;
};

/** Promo / noise tokens stripped when deriving a short Grounding prompt from a Shopify title. */
const TITLE_PROMO_RE =
  /【[^】]*】|\[[^\]]*\]|（送料無料）|\(送料無料\)|送料無料|大人気|新作|限定|セール|SALE|sale|％?\s*OFF|%OFF|★+|☆+|＊+|\*{2,}|！+|!{2,}/gi;

/** Trailing size tokens (JP / EN apparel). */
const TITLE_SIZE_TOKEN_RE =
  /^(?:フリーサイズ|FREE(?:\s*SIZE)?|ONESIZE|ONE\s*SIZE|XXL|2XL|3XL|4XL|XS|S|M|L|XL|F|[0-9]{1,3}(?:\s*[-〜～~]\s*[0-9]{1,3})?(?:\s*(?:cm|CM))?)$/i;

/** Common trailing color words in JP apparel titles (best-effort defaults). */
const TITLE_COLOR_TOKEN_RE =
  /^(?:カラー|色|ブラック|ホワイト|グレー|グレイ|ネイビー|ブルー|レッド|ピンク|ベージュ|ブラウン|グリーン|イエロー|オレンジ|パープル|カーキ|クリーム|アイボリー|シルバー|ゴールド|黒|白|灰|紺|青|赤|緑|黄|茶|黒色|白色|black|white|gray|grey|navy|blue|red|pink|beige|brown|green|yellow|orange|purple|khaki|ivory|silver|gold)$/i;

const TITLE_YEAR_SEASON_RE =
  /\b(?:20\d{2}|19\d{2})\s*(?:AW|SS|FW|春夏|秋冬)?\b|\b(?:AW|SS|FW)\s*(?:20\d{2}|19\d{2})?\b/gi;

function stripTrailingSizeColorTokens(text: string): string {
  const parts = text.split(/\s+/).filter(Boolean);
  while (parts.length > 1) {
    const last = parts[parts.length - 1] || "";
    if (TITLE_SIZE_TOKEN_RE.test(last) || TITLE_COLOR_TOKEN_RE.test(last)) {
      parts.pop();
      continue;
    }
    // Partial size like "M〜" / "M~L" after promo cleanup
    if (/^(?:XS|S|M|L|XL|XXL)[-〜～~]?$/i.test(last)) {
      parts.pop();
      continue;
    }
    break;
  }
  return parts.join(" ");
}

/**
 * Build a short default Grounding/SAM2 prompt from a Shopify product title.
 * Strips promo junk and trailing size/color noise; keeps a category-like phrase.
 * Empty / whitespace-only titles yield "".
 */
export function normalizeProductTitlePrompt(
  title: string | null | undefined,
): string {
  let text = String(title ?? "")
    .replace(/\u3000/g, " ")
    .trim();
  if (!text) return "";

  text = text
    .replace(TITLE_PROMO_RE, " ")
    .replace(TITLE_YEAR_SEASON_RE, " ")
    .replace(/[|｜／/]+/g, " ")
    .replace(/[-–—]+/g, " ")
    .replace(/[【】\[\]（）()「」『』<>]/g, " ")
    .replace(/[~〜～]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  text = stripTrailingSizeColorTokens(text);

  // Prefer the first short segment when the title is still a long catalogue line.
  if (text.length > 40) {
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      text = parts.slice(0, Math.min(4, parts.length)).join(" ");
    }
  }

  return text.trim();
}

/**
 * Effective segmentation prompt for a product: saved operator edit, else normalized title.
 */
export function effectiveProductTitlePrompt(
  title: string | null | undefined,
  manualPrompt?: string | null,
): string {
  if (typeof manualPrompt === "string") {
    return manualPrompt.trim();
  }
  return normalizeProductTitlePrompt(title);
}

export function readManualEditsBlob(raw: string): ManualEditsView {
  const parsed = safeJsonParse<unknown>(raw, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as ManualEditsView;
}

/** Stable id used by the Admin gallery radio + RunPod selection. */
export function collectedImageKey(
  img: Pick<CollectedImage, "id" | "url"> | null | undefined,
): string {
  if (!img) return "";
  const id = String(img.id || "").trim();
  if (id) return id;
  return String(img.url || "").trim();
}

/**
 * Resolve the single image used for 3D create/start.
 * Prefers a saved selectedImageId (id or url); otherwise the first gallery image.
 */
export function resolveSelectedImage<
  T extends { id?: string; url?: string | null },
>(images: T[], selectedImageId?: string | null): T | null {
  const list = (images || []).filter(
    (img) => img && typeof img.url === "string" && String(img.url).trim(),
  );
  if (list.length === 0) return null;
  const wanted = String(selectedImageId || "").trim();
  if (wanted) {
    const found = list.find((img) => {
      const id = String(img.id || "").trim();
      const url = String(img.url || "").trim();
      return id === wanted || url === wanted;
    });
    if (found) return found;
  }
  return list[0] || null;
}

/** Default radio value for the Admin gallery (first image). */
export function defaultSelectedImageId(
  images: Array<Pick<CollectedImage, "id" | "url">>,
): string {
  return collectedImageKey(images[0]);
}

/** Read `selectedImageId` from the review save form. */
export function selectedImageIdFromForm(form: FormData): string | null {
  const raw = String(form.get("selectedImageId") || "").trim();
  return raw || null;
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
