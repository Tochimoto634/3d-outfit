/**
 * Size-chart parser for apparel product descriptions.
 * Supports HTML tables (JP/EN headers) plus line/heuristic fallbacks.
 * Size charts are for merchant review / later sizing — not used in photo-only 3D generation.
 */

export type SizeLabel = string;

export type MeasurementKey =
  | "shoulder"
  | "bust"
  | "chest"
  | "waist"
  | "hip"
  | "length"
  | "sleeve"
  | string;

export type SizeChartRow = {
  size: SizeLabel;
  measurements: Partial<Record<MeasurementKey, number | null>>;
};

export type SizeChartParseResult = {
  /** Structured rows; empty when nothing reliable was found */
  rows: SizeChartRow[];
  /** Unit guessed from text (cm / inch); null if unknown */
  unit: "cm" | "inch" | null;
  /** True when parser could not find a usable chart */
  incomplete: boolean;
  /** Human-readable notes for merchants & debugging */
  notes: string[];
  /** Raw matched snippets for debugging */
  rawMatches: string[];
  /** Which strategy produced rows */
  source: "html_table" | "heuristic" | "none";
};

const MEASUREMENT_ALIASES: Record<string, MeasurementKey> = {
  肩幅: "shoulder",
  肩巾: "shoulder",
  肩: "shoulder",
  shoulder: "shoulder",
  shoulders: "shoulder",
  身幅: "bust",
  胸囲: "bust",
  バスト: "bust",
  bust: "bust",
  chest: "chest",
  ウエスト: "waist",
  ウェスト: "waist",
  腰囲: "waist",
  腰: "waist",
  waist: "waist",
  ヒップ: "hip",
  尻囲: "hip",
  hip: "hip",
  hips: "hip",
  着丈: "length",
  総丈: "length",
  丈: "length",
  length: "length",
  袖丈: "sleeve",
  ゆき: "sleeve",
  袖: "sleeve",
  sleeve: "sleeve",
  裾幅: "hem",
  hem: "hem",
};

const SIZE_TOKEN = String.raw`(?:XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|F|FREE|フリー|\d{1,2})`;

const SIZE_HEADER_RE =
  /^(?:サイズ|size|規格|号数)$|^(?:XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|F|FREE|フリー)$/i;

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
}

function stripHtml(html: string): string {
  return decodeEntities(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|tr|div|li|h\d|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function detectUnit(text: string): "cm" | "inch" | null {
  if (/\bcm\b|センチ|ｃｍ|㎝/i.test(text)) return "cm";
  if (/\binch(?:es)?\b|インチ|\"/i.test(text)) return "inch";
  return null;
}

function normalizeMeasurementLabel(raw: string): MeasurementKey | null {
  const cleaned = raw
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[\s:：]/g, "")
    .replace(/\(cm\)|（cm）|cm|㎝|inch|インチ/gi, "")
    .trim()
    .toLowerCase();
  if (!cleaned) return null;
  if (SIZE_HEADER_RE.test(cleaned) || cleaned === "size" || cleaned === "サイズ") {
    return null;
  }
  for (const [alias, key] of Object.entries(MEASUREMENT_ALIASES)) {
    if (cleaned === alias.toLowerCase() || cleaned.includes(alias.toLowerCase())) {
      return key;
    }
  }
  return null;
}

function parseNumberCell(raw: string): number | null {
  const m = raw.replace(/,/g, "").match(/(\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function isSizeLabel(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  return new RegExp(`^(?:${SIZE_TOKEN})$`, "i").test(t);
}

function normalizeSizeLabel(raw: string): string {
  const t = raw.trim();
  if (/^(?:f|free|フリー)$/i.test(t)) return "FREE";
  if (/^\d{1,2}$/.test(t)) return t;
  return t.toUpperCase();
}

function dedupeRows(rows: SizeChartRow[]): SizeChartRow[] {
  const bySize = new Map<string, SizeChartRow>();
  for (const row of rows) bySize.set(row.size, row);
  return [...bySize.values()];
}

/**
 * Parse HTML <table> blocks: first column = size, other columns = measurements
 * from header aliases (肩幅 / 身幅 / 着丈 …).
 */
export function parseHtmlTables(html: string): {
  rows: SizeChartRow[];
  rawMatches: string[];
} {
  const rows: SizeChartRow[] = [];
  const rawMatches: string[] = [];
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) || [];

  for (const table of tables) {
    const trs = table.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
    if (trs.length < 2) continue;

    let headerKeys: Array<MeasurementKey | "size" | null> | null = null;
    let sizeCol = 0;

    for (const tr of trs) {
      const cells = [
        ...(tr.match(/<th\b[\s\S]*?<\/th>/gi) || []),
        ...(tr.match(/<td\b[\s\S]*?<\/td>/gi) || []),
      ].map(cellText);

      // Prefer th-only if mixed — re-extract properly
      const ths = (tr.match(/<th\b[\s\S]*?<\/th>/gi) || []).map(cellText);
      const tds = (tr.match(/<td\b[\s\S]*?<\/td>/gi) || []).map(cellText);
      const useCells = ths.length > 0 && tds.length === 0 ? ths : cells.length ? cells : tds;
      if (useCells.length === 0) continue;

      if (!headerKeys) {
        const looksLikeHeader =
          ths.length > 0 ||
          useCells.some((c) => normalizeMeasurementLabel(c) != null) ||
          useCells.some((c) => /サイズ|size/i.test(c));
        if (!looksLikeHeader && useCells.every((c) => !isSizeLabel(c))) {
          continue;
        }

        headerKeys = useCells.map((c, idx) => {
          if (idx === 0 && (/サイズ|size|^$/i.test(c) || !normalizeMeasurementLabel(c))) {
            return "size";
          }
          if (/サイズ|size/i.test(c)) return "size";
          return normalizeMeasurementLabel(c);
        });
        sizeCol = Math.max(
          0,
          headerKeys.findIndex((k) => k === "size"),
        );
        // If this row is actually a data row with size in col0, treat headers as positional
        if (
          isSizeLabel(useCells[sizeCol] || "") &&
          headerKeys.every((k) => k == null || k === "size")
        ) {
          headerKeys = useCells.map((_, idx) =>
            idx === sizeCol
              ? "size"
              : (["shoulder", "bust", "length", "sleeve", "waist", "hip"][
                  idx < sizeCol ? idx : idx - 1
                ] as MeasurementKey) || null,
          );
          // fall through and parse this as data
        } else if (
          ths.length > 0 ||
          useCells.some((c) => /サイズ|size|肩|身幅|着丈|bust|waist|length/i.test(c))
        ) {
          rawMatches.push(`table-header: ${useCells.join(" | ")}`);
          continue;
        }
      }

      if (!headerKeys) continue;

      const sizeRaw = useCells[sizeCol] || "";
      if (!isSizeLabel(sizeRaw)) continue;

      const measurements: SizeChartRow["measurements"] = {};
      let found = false;
      for (let i = 0; i < useCells.length; i++) {
        const key = headerKeys[i];
        if (!key || key === "size") continue;
        const num = parseNumberCell(useCells[i] || "");
        if (num != null) {
          measurements[key] = num;
          found = true;
        }
      }

      // Positional fallback when headers unknown
      if (!found) {
        const nums = useCells
          .filter((_, i) => i !== sizeCol)
          .map(parseNumberCell)
          .filter((n): n is number => n != null);
        const keys: MeasurementKey[] = ["shoulder", "bust", "length", "sleeve"];
        nums.slice(0, keys.length).forEach((n, i) => {
          measurements[keys[i]!] = n;
          found = true;
        });
      }

      if (found) {
        const size = normalizeSizeLabel(sizeRaw);
        rawMatches.push(`${size}: ${useCells.join(" | ")}`.slice(0, 200));
        rows.push({ size, measurements });
      }
    }
  }

  return { rows: dedupeRows(rows), rawMatches };
}

/**
 * Heuristic: JP/EN labeled lines like `S 肩幅 38 身幅 48 着丈 65` or `M: 40/50/67`.
 */
export function parseHeuristicRows(text: string): {
  rows: SizeChartRow[];
  rawMatches: string[];
} {
  const rows: SizeChartRow[] = [];
  const rawMatches: string[] = [];

  // Split on newlines and before size tokens for dense single-line charts
  const chunks = text.split(
    /\n+|(?=(?:^|\s)(?:XXS|XS|S|M|L|XL|XXL|2XL|3XL|F|FREE|フリー)\b)/i,
  );

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    const sizeMatch = trimmed.match(
      new RegExp(`(?:^|[\\s|])(${SIZE_TOKEN})(?=[\\s:：|/]|$)`, "i"),
    );
    if (!sizeMatch) continue;

    // Prefer leading size token
    const lead = trimmed.match(new RegExp(`^(${SIZE_TOKEN})\\b`, "i"));
    const sizeRaw = lead?.[1] || sizeMatch[1]!;
    if (!isSizeLabel(sizeRaw)) continue;

    const size = normalizeSizeLabel(sizeRaw);
    const measurements: SizeChartRow["measurements"] = {};
    let found = false;

    for (const [alias, key] of Object.entries(MEASUREMENT_ALIASES)) {
      const m = trimmed.match(
        new RegExp(`${alias}[^\\d]{0,8}(\\d{2,3}(?:\\.\\d+)?)`, "i"),
      );
      if (m) {
        measurements[key] = Number(m[1]);
        found = true;
      }
    }

    if (!found) {
      const after = trimmed.slice(trimmed.toLowerCase().indexOf(sizeRaw.toLowerCase()) + sizeRaw.length);
      const nums = [...after.matchAll(/(\d{2,3}(?:\.\d+)?)/g)].map((x) =>
        Number(x[1]),
      );
      if (nums.length >= 2) {
        const keys: MeasurementKey[] = ["shoulder", "bust", "length", "sleeve"];
        nums.slice(0, keys.length).forEach((n, i) => {
          measurements[keys[i]!] = n;
        });
        found = true;
      }
    }

    if (found) {
      rawMatches.push(trimmed.slice(0, 160));
      rows.push({ size, measurements });
    }
  }

  return { rows: dedupeRows(rows), rawMatches };
}

/**
 * Parse product description into a structured size chart.
 * Prefer HTML tables; fall back to JP/EN heuristics.
 */
export function parseSizeChart(
  descriptionHtmlOrText: string | null | undefined,
): SizeChartParseResult {
  const notes: string[] = [];

  if (!descriptionHtmlOrText?.trim()) {
    return {
      rows: [],
      unit: null,
      incomplete: true,
      notes: ["説明文が空のためサイズ表を解析できません"],
      rawMatches: [],
      source: "none",
    };
  }

  const html = descriptionHtmlOrText;
  const text = stripHtml(html);
  const unit = detectUnit(html) || detectUnit(text);

  const fromTable = parseHtmlTables(html);
  if (fromTable.rows.length > 0) {
    notes.push(`HTMLテーブルから ${fromTable.rows.length} サイズを解析`);
    return {
      rows: fromTable.rows,
      unit,
      incomplete: false,
      notes,
      rawMatches: fromTable.rawMatches,
      source: "html_table",
    };
  }

  notes.push("HTMLテーブルから有効なサイズ行を検出できませんでした");

  const fromHeuristic = parseHeuristicRows(text);
  if (fromHeuristic.rows.length > 0) {
    notes.push(
      `ヒューリスティックで ${fromHeuristic.rows.length} サイズを解析`,
    );
    return {
      rows: fromHeuristic.rows,
      unit,
      incomplete: false,
      notes,
      rawMatches: fromHeuristic.rawMatches,
      source: "heuristic",
    };
  }

  notes.push("サイズ表行を検出できませんでした（手動入力してください）");
  return {
    rows: [],
    unit,
    incomplete: true,
    notes,
    rawMatches: [],
    source: "none",
  };
}

/**
 * Validate / normalize a merchant-edited size chart JSON blob.
 */
export function normalizeManualSizeChart(
  raw: unknown,
): SizeChartParseResult | null {
  if (raw == null) return null;

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Treat free text as incomplete override notes only
      return {
        rows: [],
        unit: null,
        incomplete: true,
        notes: ["手動補正は自由記述です（JSON 形式で行データを保存すると incomplete が解除されます）"],
        rawMatches: [trimmed.slice(0, 200)],
        source: "none",
      };
    }
  }

  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as {
    rows?: unknown;
    unit?: unknown;
    notes?: unknown;
  };

  const rowsIn = Array.isArray(obj.rows) ? obj.rows : Array.isArray(parsed) ? parsed : [];
  const rows: SizeChartRow[] = [];

  for (const item of rowsIn) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      size?: unknown;
      measurements?: Record<string, unknown>;
    };
    const size = typeof row.size === "string" ? normalizeSizeLabel(row.size) : "";
    if (!size) continue;
    const measurements: SizeChartRow["measurements"] = {};
    for (const [k, v] of Object.entries(row.measurements || {})) {
      if (v == null || v === "") {
        measurements[k] = null;
        continue;
      }
      const n = typeof v === "number" ? v : Number(v);
      measurements[k] = Number.isFinite(n) ? n : null;
    }
    rows.push({ size, measurements });
  }

  const unit =
    obj.unit === "cm" || obj.unit === "inch" ? obj.unit : null;

  return {
    rows: dedupeRows(rows),
    unit,
    incomplete: rows.length === 0,
    notes: Array.isArray(obj.notes)
      ? obj.notes.map(String)
      : ["手動編集のサイズ表"],
    rawMatches: [],
    source: rows.length > 0 ? "heuristic" : "none",
  };
}
