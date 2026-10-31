/**
 * Size-chart parser stub.
 * Extracts a best-effort S/M/L × body measurements table from product description HTML/text.
 * Full HTML table parsing is TODO; this ships a simple regex/heuristics starter.
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
  /** Human-readable notes / TODO markers for merchants & future work */
  notes: string[];
  /** Raw matched snippets for debugging */
  rawMatches: string[];
};

const MEASUREMENT_ALIASES: Record<string, MeasurementKey> = {
  肩幅: "shoulder",
  肩: "shoulder",
  shoulder: "shoulder",
  身幅: "bust",
  胸囲: "bust",
  バスト: "bust",
  bust: "bust",
  chest: "chest",
  ウエスト: "waist",
  腰: "waist",
  waist: "waist",
  ヒップ: "hip",
  hip: "hip",
  着丈: "length",
  丈: "length",
  length: "length",
  袖丈: "sleeve",
  袖: "sleeve",
  sleeve: "sleeve",
};

const SIZE_TOKEN = String.raw`(?:XXS|XS|S|M|L|XL|XXL|2XL|3XL|F|FREE|\d{1,2})`;

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|tr|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function detectUnit(text: string): "cm" | "inch" | null {
  if (/\bcm\b|センチ|ｃｍ/i.test(text)) return "cm";
  if (/\binch(?:es)?\b|インチ|\"/i.test(text)) return "inch";
  return null;
}

/**
 * Heuristic: look for patterns like `S 肩幅 38 身幅 48 着丈 65` or `M: 40/50/67`.
 */
function parseHeuristicRows(text: string): {
  rows: SizeChartRow[];
  rawMatches: string[];
} {
  const rows: SizeChartRow[] = [];
  const rawMatches: string[] = [];

  // Pattern A: SIZE then labeled measurements (JP/EN)
  const labeled =
    new RegExp(
      `\\b(${SIZE_TOKEN})\\b[^\\n]{0,80}?((?:${Object.keys(MEASUREMENT_ALIASES).join("|")})[^\\d]{0,6}\\d{2,3}(?:\\.\\d+)?)`,
      "gi",
    );

  // Simpler line-oriented scan
  const lineRe = new RegExp(
    `\\b(${SIZE_TOKEN})\\b[:：\\s|]*([\\d./\\s|]+)`,
    "gi",
  );

  for (const line of text.split(/\n|(?=\b(?:XXS|XS|S|M|L|XL|XXL)\b)/i)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const sizeMatch = trimmed.match(
      new RegExp(`^(${SIZE_TOKEN})\\b`, "i"),
    );
    if (!sizeMatch) continue;

    const size = sizeMatch[1]!.toUpperCase();
    const measurements: SizeChartRow["measurements"] = {};
    let found = false;

    for (const [alias, key] of Object.entries(MEASUREMENT_ALIASES)) {
      const m = trimmed.match(
        new RegExp(`${alias}[^\\d]{0,6}(\\d{2,3}(?:\\.\\d+)?)`, "i"),
      );
      if (m) {
        measurements[key] = Number(m[1]);
        found = true;
      }
    }

    // Fallback: slash- or pipe-separated numbers after size token
    if (!found) {
      const nums = [...trimmed.matchAll(/(\d{2,3}(?:\.\d+)?)/g)].map((x) =>
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

  // Silence unused regex for now (kept for future refinement)
  void labeled;
  void lineRe;

  // Dedupe by size (last wins)
  const bySize = new Map<string, SizeChartRow>();
  for (const row of rows) bySize.set(row.size, row);

  return { rows: [...bySize.values()], rawMatches };
}

/**
 * Parse product description into a structured size chart.
 * Returns incomplete=true with empty rows when nothing useful is found.
 */
export function parseSizeChart(
  descriptionHtmlOrText: string | null | undefined,
): SizeChartParseResult {
  const notes: string[] = [
    "TODO: HTML table parser (thead/tbody) not implemented yet",
  ];

  if (!descriptionHtmlOrText?.trim()) {
    return {
      rows: [],
      unit: null,
      incomplete: true,
      notes: [...notes, "説明文が空のためサイズ表を解析できません"],
      rawMatches: [],
    };
  }

  const text = stripHtml(descriptionHtmlOrText);
  const unit = detectUnit(text);
  const { rows, rawMatches } = parseHeuristicRows(text);

  if (rows.length === 0) {
    notes.push("正規表現ヒューリスティックでサイズ行を検出できませんでした");
  }

  return {
    rows,
    unit,
    incomplete: rows.length === 0,
    notes,
    rawMatches,
  };
}
