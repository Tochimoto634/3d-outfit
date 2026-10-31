#!/usr/bin/env node
/**
 * Smoke tests for size-chart parser (HTML tables + JP heuristics).
 * No Shopify / RunPod credentials required.
 * Run: npm run smoke:size-chart
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runner = resolve(tmpdir(), `size-chart-smoke-${process.pid}.mts`);

const source = `
import {
  parseSizeChart,
  normalizeManualSizeChart,
} from ${JSON.stringify(resolve(root, "app/services/size-chart.server.ts"))};

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const htmlTable = \`
<p>サイズ表</p>
<table>
  <tr><th>サイズ</th><th>肩幅</th><th>身幅</th><th>着丈</th><th>袖丈</th></tr>
  <tr><td>S</td><td>38</td><td>48</td><td>65</td><td>58</td></tr>
  <tr><td>M</td><td>40</td><td>50</td><td>67</td><td>59</td></tr>
  <tr><td>L</td><td>42</td><td>52</td><td>69</td><td>60</td></tr>
</table>
\`;

const heuristicText = \`
素材: 綿100%
S 肩幅 38 身幅 48 着丈 65
M 肩幅 40 身幅 50 着丈 67
単位: cm
\`;

const emptyHtml = "<p>かわいいワンピースです</p>";

const tableResult = parseSizeChart(htmlTable);
assert(tableResult.source === "html_table", \`expected html_table, got \${tableResult.source}\`);
assert(tableResult.rows.length === 3, \`expected 3 rows, got \${tableResult.rows.length}\`);
assert(tableResult.rows[0]!.measurements.shoulder === 38, "S shoulder");
assert(tableResult.incomplete === false, "table should be complete");

const heur = parseSizeChart(heuristicText);
assert(heur.source === "heuristic", \`expected heuristic, got \${heur.source}\`);
assert(heur.rows.length >= 2, "expected >=2 heuristic rows");
assert(heur.unit === "cm", "heuristic unit cm");

const empty = parseSizeChart(emptyHtml);
assert(empty.incomplete === true, "empty chart incomplete");
assert(empty.rows.length === 0, "empty rows");

const manual = normalizeManualSizeChart(
  JSON.stringify({
    unit: "cm",
    rows: [{ size: "M", measurements: { bust: 50, length: 70 } }],
  }),
);
assert(!!manual && manual.rows.length === 1, "manual parse");
assert(manual!.incomplete === false, "manual complete");

console.log(JSON.stringify({
  ok: true,
  tableRows: tableResult.rows.length,
  tableSource: tableResult.source,
  heuristicRows: heur.rows.length,
  emptyIncomplete: empty.incomplete,
  manualRows: manual!.rows.length,
}, null, 2));
`;

writeFileSync(runner, source, "utf8");
try {
  const result = spawnSync(
    "npx",
    ["--yes", "tsx", runner],
    { cwd: root, encoding: "utf8", env: process.env },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
} finally {
  try {
    unlinkSync(runner);
  } catch {
    // ignore
  }
}
