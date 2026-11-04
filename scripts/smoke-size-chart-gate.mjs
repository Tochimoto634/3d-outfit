/**
 * Smoke: size chart is a hard create-start gate (usable rows required).
 * Run: npm run smoke:size-chart-gate
 */
import assert from "node:assert/strict";
import {
  productHasUsableSizeChart,
  productsMissingSizeChart,
} from "../app/services/product-collect.server.ts";

function check(name, fn) {
  try {
    fn();
    console.log(`OK  ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

const emptyChart = JSON.stringify({
  rows: [],
  unit: null,
  incomplete: true,
  notes: [],
  source: "none",
});

const usableChart = JSON.stringify({
  rows: [{ size: "M", measurements: { bust: 50, length: 70 } }],
  unit: "cm",
  incomplete: false,
  notes: [],
  source: "html_table",
});

check("empty sizeChartJson → not usable", () => {
  assert.equal(productHasUsableSizeChart({ sizeChartJson: emptyChart }), false);
});

check("rows present → usable", () => {
  assert.equal(productHasUsableSizeChart({ sizeChartJson: usableChart }), true);
});

check("manual override fills empty chart", () => {
  const manual = JSON.stringify({
    sizeChartOverride: JSON.stringify({
      unit: "cm",
      rows: [{ size: "S", measurements: { length: 60 } }],
    }),
  });
  assert.equal(
    productHasUsableSizeChart({
      sizeChartJson: emptyChart,
      manualEditsJson: manual,
    }),
    true,
  );
});

check("productsMissingSizeChart lists titles", () => {
  const missing = productsMissingSizeChart([
    {
      title: "NoChart",
      shopifyProductId: "gid://1",
      sizeChartJson: emptyChart,
    },
    {
      title: "HasChart",
      shopifyProductId: "gid://2",
      sizeChartJson: usableChart,
    },
  ]);
  assert.deepEqual(missing, ["NoChart"]);
});

console.log("smoke-size-chart-gate: all passed");
