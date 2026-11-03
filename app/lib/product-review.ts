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
  /**
   * Optional tagged media role (merchant/app metadata).
   * Known positives: model | on_model | worn | 着画
   * Known negatives: flat | ghost | detail | swatch | packshot
   * Full vision/CV detection is deferred; heuristics + override cover MVP.
   */
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
  size_chart: "サイズ表未解析（後工程のサイズ展開用・手動入力可）",
  model_meta: "モデル身長・体型メタなし（着用モデル写真あり時のみ・任意）",
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
  /**
   * Merchant override for「着用モデル写真あり」.
   * `null` / omitted → use heuristic detection from alt / filename / mediaRole.
   */
  hasModelPhotoOverride?: boolean | null;
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

/** Alt / filename / role hints that a photo shows a person wearing the garment. */
export const MODEL_PHOTO_POSITIVE_RE =
  /(?:^|[^a-z0-9])(?:on[\s_-]?model|worn[\s_-]?by|model(?:shot|wear|ling)?|mannequin)(?:[^a-z0-9]|$)|着用(?:モデル|写真|画|人)?|着画|モデル(?:写真|着用|着画)?|人体/i;

const MODEL_PHOTO_POSITIVE_ROLES = new Set([
  "model",
  "on_model",
  "on-model",
  "worn",
  "wearing",
  "着画",
  "着用",
  "モデル",
]);

const MODEL_PHOTO_NEGATIVE_ROLES = new Set([
  "flat",
  "flatlay",
  "flat_lay",
  "ghost",
  "ghostman",
  "detail",
  "swatch",
  "packshot",
  "still",
  "product",
  "hanging",
]);

export type ModelPhotoDetection = {
  /** Heuristic found at least one likely on-model image. */
  detectedFromMedia: boolean;
  matchedImageIds: string[];
  matchedHints: string[];
  /** Explicit merchant checkbox when set. */
  override: boolean | null;
  /** Final gate: override ?? detectedFromMedia */
  hasModelPhoto: boolean;
  source: "override_on" | "override_off" | "heuristic" | "none";
};

export function filenameFromImageUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split("/").pop() || "");
  } catch {
    const trimmed = String(url || "").split("?")[0] || "";
    return decodeURIComponent(trimmed.split("/").pop() || trimmed);
  }
}

/**
 * Pragmatic MVP: does this image look like a person wearing the garment?
 * Prefer tagged mediaRole, then altText + CDN filename heuristics.
 * Not a CV model — false negatives/positives are expected; merchants can override.
 */
export function imageSuggestsModelPhoto(img: {
  id?: string;
  url?: string | null;
  altText?: string | null;
  mediaRole?: string | null;
}): { match: boolean; hint: string | null } {
  const roleRaw = String(img.mediaRole || "").trim();
  const role = roleRaw.toLowerCase();
  if (role && MODEL_PHOTO_POSITIVE_ROLES.has(role)) {
    return { match: true, hint: `role:${roleRaw}` };
  }
  if (role && MODEL_PHOTO_NEGATIVE_ROLES.has(role)) {
    return { match: false, hint: null };
  }

  const file = filenameFromImageUrl(img.url || "");
  const blob = `${img.altText || ""} ${file}`;
  if (MODEL_PHOTO_POSITIVE_RE.test(blob)) {
    const m = blob.match(MODEL_PHOTO_POSITIVE_RE);
    return { match: true, hint: `text:${(m?.[0] || "pattern").trim()}` };
  }
  return { match: false, hint: null };
}

/**
 * Resolve whether the review UI should show model height/weight/body fields.
 */
export function detectModelPhotoPresence(
  images: Array<{
    id?: string;
    url?: string | null;
    altText?: string | null;
    mediaRole?: string | null;
  }>,
  override?: boolean | null,
): ModelPhotoDetection {
  const matchedImageIds: string[] = [];
  const matchedHints: string[] = [];
  for (const img of images || []) {
    const { match, hint } = imageSuggestsModelPhoto(img);
    if (!match) continue;
    matchedImageIds.push(String(img.id || img.url || matchedImageIds.length));
    if (hint) matchedHints.push(hint);
  }
  const detectedFromMedia = matchedImageIds.length > 0;
  if (override === true) {
    return {
      detectedFromMedia,
      matchedImageIds,
      matchedHints,
      override: true,
      hasModelPhoto: true,
      source: "override_on",
    };
  }
  if (override === false) {
    return {
      detectedFromMedia,
      matchedImageIds,
      matchedHints,
      override: false,
      hasModelPhoto: false,
      source: "override_off",
    };
  }
  return {
    detectedFromMedia,
    matchedImageIds,
    matchedHints,
    override: null,
    hasModelPhoto: detectedFromMedia,
    source: detectedFromMedia ? "heuristic" : "none",
  };
}

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

/**
 * Merchant checkbox 「着用モデル写真あり」.
 * Returns null when the field was not posted (legacy forms).
 */
export function hasModelPhotoOverrideFromForm(
  form: FormData,
): boolean | null {
  if (!form.has("hasModelPhotoOverridePosted")) return null;
  return String(form.get("hasModelPhotoOverride") || "") === "1";
}

/**
 * Read model-body labeled fields from the review form.
 * Returns null when the model-body section was hidden (do not wipe prior meta).
 */
export function modelMetaOverrideFromForm(
  form: FormData,
): Partial<ModelBodyMeta> | null {
  if (String(form.get("modelFieldsEnabled") || "") !== "1") {
    return null;
  }
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
