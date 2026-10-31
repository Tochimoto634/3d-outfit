import type { CSSProperties } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  collectMeasurementKeys,
  editableSizeChartRows,
  effectiveModelMeta,
  measurementLabelJa,
  missingFlagLabel,
  modelMetaOverrideFromForm,
  readManualEditsBlob,
  readMetafieldsBlob,
  readSizeChartBlob,
  REVIEW_GALLERY_PREVIEW_LIMIT,
  safeJsonArray,
  sizeChartOverrideFromTableForm,
  sizeChartToEditorJson,
  type CollectedImage,
} from "../lib/product-review";
import {
  confirmAndStartGeneration,
  GenerationBlockedError,
  getGenerationJob,
  getJobStartBlockers,
  pollAndSyncEngineRuns,
  updateProductManualEdits,
} from "../services/jobs.server";
import {
  getRunPodPublicConfig,
  isRunPodMockMode,
} from "../services/runpod.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const job = await getGenerationJob(params.id!);
  if (!job) {
    throw new Response("Job not found", { status: 404 });
  }

  const blockers = getJobStartBlockers(job.products);

  return {
    job,
    blockers,
    runpodMock: isRunPodMockMode(),
    runpod: getRunPodPublicConfig(),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "save_edits") {
    const snapshotId = String(form.get("snapshotId") || "");
    const notes = String(form.get("reviewNotes") || "");
    const useAdvancedJson = String(form.get("useSizeChartJson") || "") === "1";
    const advancedJson = String(form.get("sizeChartOverride") || "").trim();
    const fromTable = sizeChartOverrideFromTableForm(form);
    const sizeChartOverride = useAdvancedJson
      ? advancedJson || null
      : fromTable || advancedJson || null;
    const modelMetaOverride = modelMetaOverrideFromForm(form);

    await updateProductManualEdits(snapshotId, {
      reviewNotes: notes,
      sizeChartOverride,
      modelMetaOverride,
      updatedAt: new Date().toISOString(),
    });
    return { ok: true, intent: "save_edits" as const };
  }

  if (intent === "confirm_start") {
    try {
      const result = await confirmAndStartGeneration(params.id!);
      return {
        ok: true,
        intent: "confirm_start" as const,
        mock: result.mock,
        runCount: result.runs.length,
      };
    } catch (err) {
      if (err instanceof GenerationBlockedError) {
        return {
          ok: false,
          intent: "confirm_start" as const,
          error: err.message,
          missingImages: err.productTitles,
        };
      }
      throw err;
    }
  }

  if (intent === "poll_status") {
    const result = await pollAndSyncEngineRuns(params.id!);
    return {
      ok: true,
      intent: "poll_status" as const,
      mock: result.mock,
      jobStatus: result.job.status,
      updateCount: result.updates.length,
      updates: result.updates,
    };
  }

  return { ok: false, intent: "unknown" as const };
};

const cellInputStyle: CSSProperties = {
  width: "100%",
  minWidth: "4.5rem",
  padding: "6px 8px",
  border: "1px solid #c9cccf",
  borderRadius: "6px",
  fontSize: "13px",
  boxSizing: "border-box",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  borderBottom: "1px solid #dfe3e8",
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "6px 8px",
  verticalAlign: "middle",
};

function formatSourceLabel(source?: string | null): string {
  switch (source) {
    case "html_table":
      return "HTMLテーブル";
    case "heuristic":
      return "テキスト解析";
    case "none":
      return "未解析";
    default:
      return source || "不明";
  }
}

export default function GenerationJobPage() {
  const { job, blockers, runpodMock, runpod } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const canStart = job.status === "review" || job.status === "collecting";
  const canPoll =
    job.status === "generating" ||
    job.engineRuns.some((r) =>
      ["queued", "submitted", "running", "succeeded"].includes(r.status),
    );
  const startBlocked = blockers.blocked;

  return (
    <s-page heading={job.title || `ジョブ ${job.id}`}>
      <s-stack direction="block" gap="base">
        <s-banner tone={job.status === "failed" ? "critical" : "info"}>
          ステータス: <s-text type="strong">{job.status}</s-text>
          {runpodMock
            ? " ／ RunPod: モックモード（APIキー未設定）"
            : " ／ RunPod: ライブ設定あり"}
          {runpod.endpointIdConfigured ? "" : " ／ ENDPOINT_ID 未設定"}
        </s-banner>

        {actionData &&
        "intent" in actionData &&
        actionData.intent === "save_edits" &&
        actionData.ok ? (
          <s-banner tone="success">手動編集を保存しました</s-banner>
        ) : null}

        {actionData &&
        "intent" in actionData &&
        actionData.intent === "confirm_start" &&
        actionData.ok ? (
          <s-banner tone="success">
            作成を開始しました（engine runs: {actionData.runCount}
            {actionData.mock ? ", mock" : ""}）—「状態を更新」でポーリングできます
          </s-banner>
        ) : null}

        {actionData &&
        "intent" in actionData &&
        actionData.intent === "confirm_start" &&
        !actionData.ok &&
        "error" in actionData ? (
          <s-banner tone="critical">{actionData.error}</s-banner>
        ) : null}

        {actionData &&
        "intent" in actionData &&
        actionData.intent === "poll_status" &&
        actionData.ok ? (
          <s-banner tone="success">
            状態を同期しました → job: {actionData.jobStatus}（updates:{" "}
            {actionData.updateCount}
            {actionData.mock ? ", mock" : ""}）
          </s-banner>
        ) : null}

        <s-section heading="選択商品の収集結果">
          <s-paragraph>
            画像・サイズ表・モデル体型を表／入力欄で確認し、不足があれば補完してから作成を開始してください。
            3D 生成は写真のみを使用します（サイズ表は生成には使いません・後のサイズ展開用）。
          </s-paragraph>
        </s-section>

        {job.products.map((product) => {
          const images = safeJsonArray<CollectedImage>(product.imagesJson).filter(
            (img) => img && typeof img.url === "string" && img.url.trim(),
          );
          const previewImages = images.slice(0, REVIEW_GALLERY_PREVIEW_LIMIT);
          const hiddenImageCount = Math.max(
            0,
            images.length - previewImages.length,
          );
          const { fields: metafields, modelMeta } = readMetafieldsBlob(
            product.metafieldsJson,
          );
          const sizeChart = readSizeChartBlob(product.sizeChartJson);
          const missing = safeJsonArray<string>(product.missingFlagsJson);
          const manual = readManualEditsBlob(product.manualEditsJson);
          const model = effectiveModelMeta(modelMeta, manual.modelMetaOverride);
          const criticalMissing = missing.includes("images");
          const measurementKeys = collectMeasurementKeys(sizeChart.rows);
          const editorRows = editableSizeChartRows(sizeChart);
          const advancedJsonDefault =
            manual.sizeChartOverride?.trim() || sizeChartToEditorJson(sizeChart);
          const modelRelated = metafields.filter((mf) =>
            /model|モデル|身長|height|body|体型|worn|着用/i.test(
              `${mf.namespace || ""}.${mf.key || ""} ${mf.description || ""}`,
            ),
          );
          const metafieldRows =
            modelRelated.length > 0 ? modelRelated : metafields.slice(0, 40);

          return (
            <s-section
              key={product.id}
              heading={product.title || product.shopifyProductId}
            >
              <s-stack direction="block" gap="base">
                <s-paragraph>
                  ID: <code>{product.shopifyProductId}</code>
                  {product.handle ? ` ／ handle: ${product.handle}` : ""}
                </s-paragraph>

                {missing.length > 0 ? (
                  <s-banner tone={criticalMissing ? "critical" : "warning"}>
                    <s-stack direction="block" gap="base">
                      <s-text type="strong">不足フラグ</s-text>
                      <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                        {missing.map((flag) => (
                          <li key={flag}>{missingFlagLabel(flag)}</li>
                        ))}
                      </ul>
                    </s-stack>
                  </s-banner>
                ) : (
                  <s-banner tone="success">必須データの欠損フラグなし</s-banner>
                )}

                <s-heading>
                  画像ギャラリー（{images.length} 枚）
                  {criticalMissing ? " — 3D作成に必須" : ""}
                </s-heading>
                {images.length === 0 ? (
                  <s-banner tone="critical">
                    商品写真がありません。Shopify
                    商品に画像を追加してから、もう一度「3D作成」でジョブを作り直してください。
                  </s-banner>
                ) : (
                  <s-stack direction="block" gap="base">
                    <s-stack direction="inline" gap="base">
                      {previewImages.map((img, idx) => (
                        <s-box
                          key={img.id || idx}
                          padding="small"
                          borderWidth="base"
                          borderRadius="base"
                          background="subdued"
                        >
                          <a
                            href={img.url}
                            target="_blank"
                            rel="noreferrer"
                            title={img.altText || `image ${idx + 1}`}
                          >
                            {/* eslint-disable-next-line jsx-a11y/alt-text */}
                            <img
                              src={img.url}
                              alt={img.altText || product.title || "product"}
                              width={120}
                              height={120}
                              style={{ objectFit: "cover", display: "block" }}
                              loading="lazy"
                              decoding="async"
                            />
                          </a>
                          <s-paragraph>
                            #{img.position || idx + 1}
                            {img.source ? ` · ${img.source}` : ""}
                          </s-paragraph>
                        </s-box>
                      ))}
                    </s-stack>
                    {hiddenImageCount > 0 ? (
                      <s-banner tone="info">
                        表示を {REVIEW_GALLERY_PREVIEW_LIMIT}{" "}
                        枚に制限しています（残り {hiddenImageCount}{" "}
                        枚は原寸リンク用に保持。生成には全写真を使います）。
                      </s-banner>
                    ) : null}
                  </s-stack>
                )}

                <Form method="post">
                  <input type="hidden" name="intent" value="save_edits" />
                  <input type="hidden" name="snapshotId" value={product.id} />
                  <input
                    type="hidden"
                    name="sc_keys"
                    value={measurementKeys.join(",")}
                  />
                  <input
                    type="hidden"
                    name="sc_row_count"
                    value={String(editorRows.length)}
                  />

                  <s-stack direction="block" gap="base">
                    <s-heading>
                      サイズ表（編集可）
                      {sizeChart.source
                        ? ` ／ 解析: ${formatSourceLabel(sizeChart.source)}`
                        : ""}
                    </s-heading>
                    <s-paragraph>
                      行＝サイズ、列＝寸法（肩幅・身幅・着丈など）。空欄は未入力です。保存すると不足フラグを再計算します。
                    </s-paragraph>

                    {sizeChart.rows.length === 0 ? (
                      <s-banner tone="warning">
                        サイズ表を自動解析できませんでした。下の表に手動入力できます（後工程用・3D生成には使いません）。
                      </s-banner>
                    ) : null}

                    <s-box
                      padding="base"
                      borderWidth="base"
                      borderRadius="base"
                      background="subdued"
                    >
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          marginBottom: "0.75rem",
                          fontSize: "13px",
                        }}
                      >
                        単位
                        <select
                          name="sc_unit"
                          defaultValue={sizeChart.unit || "cm"}
                          style={cellInputStyle}
                        >
                          <option value="cm">cm</option>
                          <option value="inch">inch</option>
                          <option value="">未設定</option>
                        </select>
                      </label>

                      <div style={{ overflowX: "auto" }}>
                        <table style={tableStyle}>
                          <thead>
                            <tr>
                              <th style={thStyle}>サイズ</th>
                              {measurementKeys.map((key) => (
                                <th key={key} style={thStyle}>
                                  {measurementLabelJa(key)}
                                  <span
                                    style={{
                                      display: "block",
                                      fontWeight: 400,
                                      color: "#6d7175",
                                      fontSize: "11px",
                                    }}
                                  >
                                    {key}
                                  </span>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {editorRows.map((row, rowIdx) => (
                              <tr key={`${row.size || "row"}-${rowIdx}`}>
                                <td style={tdStyle}>
                                  <input
                                    name={`sc_size_${rowIdx}`}
                                    defaultValue={row.size || ""}
                                    placeholder="S / M / L"
                                    aria-label={`サイズ ${rowIdx + 1}`}
                                    style={cellInputStyle}
                                  />
                                </td>
                                {measurementKeys.map((key) => (
                                  <td key={key} style={tdStyle}>
                                    <input
                                      name={`sc_m_${rowIdx}_${key}`}
                                      defaultValue={
                                        row.measurements?.[key] == null
                                          ? ""
                                          : String(row.measurements[key])
                                      }
                                      inputMode="decimal"
                                      placeholder="—"
                                      aria-label={`${row.size || `行${rowIdx + 1}`} ${measurementLabelJa(key)}`}
                                      style={cellInputStyle}
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {sizeChart.notes?.length ? (
                        <s-paragraph>
                          メモ: {sizeChart.notes.join(" / ")}
                        </s-paragraph>
                      ) : null}
                    </s-box>

                    <details
                      style={{
                        border: "1px solid #dfe3e8",
                        borderRadius: "8px",
                        padding: "0.75rem 1rem",
                        background: "#fafbfb",
                      }}
                    >
                      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                        高度な編集（サイズ表 JSON・任意）
                      </summary>
                      <s-stack direction="block" gap="base">
                        <s-paragraph>
                          通常は上の表を編集してください。JSON
                          を直接使う場合のみ、下にチェックを入れて保存します。
                        </s-paragraph>
                        <label
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            fontSize: "13px",
                          }}
                        >
                          <input
                            type="checkbox"
                            name="useSizeChartJson"
                            value="1"
                          />
                          この JSON を表より優先して保存する
                        </label>
                        <s-text-area
                          name="sizeChartOverride"
                          label="サイズ表 JSON（{ unit, rows: [{ size, measurements }] }）"
                          rows={8}
                          defaultValue={advancedJsonDefault}
                        />
                      </s-stack>
                    </details>

                    <s-heading>モデル身長・体型</s-heading>
                    <s-paragraph>
                      メタフィールドから抽出した値です。不足があれば直接入力できます。
                    </s-paragraph>
                    <s-box
                      padding="base"
                      borderWidth="base"
                      borderRadius="base"
                      background="subdued"
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(140px, 1fr))",
                          gap: "0.75rem",
                        }}
                      >
                        <label style={{ fontSize: "13px" }}>
                          身長 (cm)
                          <input
                            name="model_heightCm"
                            defaultValue={
                              model.heightCm == null ? "" : String(model.heightCm)
                            }
                            inputMode="decimal"
                            placeholder="例: 165"
                            style={{ ...cellInputStyle, marginTop: 4 }}
                          />
                        </label>
                        <label style={{ fontSize: "13px" }}>
                          体重 (kg)
                          <input
                            name="model_weightKg"
                            defaultValue={
                              model.weightKg == null ? "" : String(model.weightKg)
                            }
                            inputMode="decimal"
                            placeholder="例: 48"
                            style={{ ...cellInputStyle, marginTop: 4 }}
                          />
                        </label>
                        <label style={{ fontSize: "13px" }}>
                          バスト (cm)
                          <input
                            name="model_bustCm"
                            defaultValue={
                              model.bustCm == null ? "" : String(model.bustCm)
                            }
                            inputMode="decimal"
                            style={{ ...cellInputStyle, marginTop: 4 }}
                          />
                        </label>
                        <label style={{ fontSize: "13px" }}>
                          ウエスト (cm)
                          <input
                            name="model_waistCm"
                            defaultValue={
                              model.waistCm == null ? "" : String(model.waistCm)
                            }
                            inputMode="decimal"
                            style={{ ...cellInputStyle, marginTop: 4 }}
                          />
                        </label>
                        <label style={{ fontSize: "13px" }}>
                          ヒップ (cm)
                          <input
                            name="model_hipCm"
                            defaultValue={
                              model.hipCm == null ? "" : String(model.hipCm)
                            }
                            inputMode="decimal"
                            style={{ ...cellInputStyle, marginTop: 4 }}
                          />
                        </label>
                        <label style={{ fontSize: "13px" }}>
                          着用サイズ
                          <input
                            name="model_sizeWorn"
                            defaultValue={model.sizeWorn || ""}
                            placeholder="例: M"
                            style={{ ...cellInputStyle, marginTop: 4 }}
                          />
                        </label>
                      </div>
                      {model.sourceKeys?.length ? (
                        <s-paragraph>
                          参照キー: {model.sourceKeys.join(", ")}
                        </s-paragraph>
                      ) : null}
                      {model.notes?.length ? (
                        <s-paragraph>
                          抽出メモ: {model.notes.join(" / ")}
                        </s-paragraph>
                      ) : null}
                    </s-box>

                    <s-heading>
                      メタフィールド（{metafields.length} 件
                      {modelRelated.length
                        ? ` ／ モデル関連 ${modelRelated.length}`
                        : ""}
                      ）
                    </s-heading>
                    <s-box
                      padding="base"
                      borderWidth="base"
                      borderRadius="base"
                      background="subdued"
                    >
                      {metafieldRows.length === 0 ? (
                        <s-paragraph>メタフィールドなし</s-paragraph>
                      ) : (
                        <div style={{ overflowX: "auto" }}>
                          <table style={tableStyle}>
                            <thead>
                              <tr>
                                <th style={thStyle}>名前空間.key</th>
                                <th style={thStyle}>値</th>
                                <th style={thStyle}>型</th>
                              </tr>
                            </thead>
                            <tbody>
                              {metafieldRows.map((mf, idx) => (
                                <tr
                                  key={`${mf.namespace}.${mf.key}.${idx}`}
                                >
                                  <td style={tdStyle}>
                                    <code>
                                      {mf.namespace}.{mf.key}
                                    </code>
                                    {mf.description ? (
                                      <div
                                        style={{
                                          color: "#6d7175",
                                          fontSize: "11px",
                                        }}
                                      >
                                        {mf.description}
                                      </div>
                                    ) : null}
                                  </td>
                                  <td
                                    style={{
                                      ...tdStyle,
                                      maxWidth: "28rem",
                                      wordBreak: "break-word",
                                    }}
                                  >
                                    {mf.value || "—"}
                                  </td>
                                  <td style={tdStyle}>{mf.type || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {metafields.length > metafieldRows.length ? (
                        <s-paragraph>
                          表示はモデル関連（または先頭 40
                          件）に絞っています。全件は高度な JSON
                          ではなく表で確認してください。
                        </s-paragraph>
                      ) : null}
                    </s-box>

                    <s-heading>レビューメモ</s-heading>
                    <s-text-area
                      name="reviewNotes"
                      label="レビューメモ"
                      rows={3}
                      defaultValue={
                        manual.reviewNotes || product.reviewNotes || ""
                      }
                    />

                    <s-button type="submit" variant="secondary" disabled={busy}>
                      この商品の手動編集を保存
                    </s-button>
                  </s-stack>
                </Form>

                {product.assets?.length ? (
                  <>
                    <s-heading>Asset3D</s-heading>
                    <s-box
                      padding="base"
                      borderWidth="base"
                      borderRadius="base"
                      background="subdued"
                    >
                      <div style={{ overflowX: "auto" }}>
                        <table style={tableStyle}>
                          <thead>
                            <tr>
                              <th style={thStyle}>種別</th>
                              <th style={thStyle}>サイズ</th>
                              <th style={thStyle}>URL</th>
                            </tr>
                          </thead>
                          <tbody>
                            {product.assets.map((a) => (
                              <tr key={a.id}>
                                <td style={tdStyle}>{a.kind || "—"}</td>
                                <td style={tdStyle}>{a.sizeLabel || "—"}</td>
                                <td style={tdStyle}>
                                  {a.storageUrl ? (
                                    <a
                                      href={a.storageUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {a.storageUrl}
                                    </a>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </s-box>
                  </>
                ) : null}
              </s-stack>
            </s-section>
          );
        })}

        <s-section heading="作成開始">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              確認後、RunPod へ写真のみの生成ジョブを投入します。ComfyUI /
              TRELLIS.2 ワークフロー JSON は{" "}
              <code>config/runpod-trellis-workflow.json</code>{" "}
              （または env）で編集できます。キー未設定時はモックのまま動作します。
            </s-paragraph>

            {startBlocked ? (
              <s-banner tone="critical">
                写真がない商品があるため「確認して作成開始」を実行できません:{" "}
                {blockers.missingImages.join(", ")}
              </s-banner>
            ) : null}

            {!startBlocked && blockers.softWarnings.length > 0 ? (
              <s-banner tone="warning">
                <s-stack direction="block" gap="base">
                  <s-text type="strong">
                    作成は可能ですが、以下の不足があります
                  </s-text>
                  <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                    {blockers.softWarnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </s-stack>
              </s-banner>
            ) : null}

            <Form method="post">
              <input type="hidden" name="intent" value="confirm_start" />
              <s-button
                type="submit"
                variant="primary"
                disabled={busy || !canStart || startBlocked}
              >
                確認して作成開始
              </s-button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="poll_status" />
              <s-button
                type="submit"
                variant="secondary"
                disabled={busy || !canPoll}
              >
                状態を更新（RunPod ポーリング）
              </s-button>
            </Form>
          </s-stack>
        </s-section>

        {job.engineRuns.length > 0 ? (
          <s-section heading="EngineRun ログ">
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>ステータス</th>
                    <th style={thStyle}>外部 Run ID</th>
                    <th style={thStyle}>Endpoint</th>
                    <th style={thStyle}>写真のみ</th>
                    <th style={thStyle}>Asset数</th>
                    <th style={thStyle}>エラー</th>
                  </tr>
                </thead>
                <tbody>
                  {job.engineRuns.map((r) => (
                    <tr key={r.id}>
                      <td style={tdStyle}>{r.status}</td>
                      <td style={tdStyle}>
                        <code>{r.externalRunId || "—"}</code>
                      </td>
                      <td style={tdStyle}>{r.endpointId || "—"}</td>
                      <td style={tdStyle}>{r.photoOnly ? "はい" : "いいえ"}</td>
                      <td style={tdStyle}>{r.assets?.length ?? 0}</td>
                      <td style={tdStyle}>{r.errorMessage || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </s-section>
        ) : null}
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
