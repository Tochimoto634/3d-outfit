import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  confirmAndStartGeneration,
  GenerationBlockedError,
  getGenerationJob,
  getJobStartBlockers,
  pollAndSyncEngineRuns,
  updateProductManualEdits,
} from "../services/jobs.server";
import {
  MISSING_FLAG_LABELS,
  type CollectedImage,
  type CollectedMetafield,
  type MissingFlag,
  type ModelBodyMeta,
} from "../services/product-collect.server";
import type { SizeChartParseResult } from "../services/size-chart.server";
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
    const sizeChartOverride = String(form.get("sizeChartOverride") || "");
    await updateProductManualEdits(snapshotId, {
      reviewNotes: notes,
      sizeChartOverride: sizeChartOverride || null,
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

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readMetafields(raw: string): {
  fields: CollectedMetafield[];
  modelMeta: ModelBodyMeta | null;
} {
  const parsed = safeJson<unknown>(raw, []);
  if (Array.isArray(parsed)) {
    return { fields: parsed as CollectedMetafield[], modelMeta: null };
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as {
      fields?: CollectedMetafield[];
      modelMeta?: ModelBodyMeta;
    };
    return {
      fields: Array.isArray(obj.fields) ? obj.fields : [],
      modelMeta: obj.modelMeta || null,
    };
  }
  return { fields: [], modelMeta: null };
}

function flagLabel(flag: string): string {
  return MISSING_FLAG_LABELS[flag as MissingFlag] || flag;
}

function defaultSizeChartEditorValue(
  sizeChart: SizeChartParseResult,
  override: string | null | undefined,
): string {
  if (override?.trim()) return override;
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
            画像・サイズ表・メタフィールド（モデル身長・体型）を確認し、不足があれば手動で補完してから作成を開始してください。
            3D 生成は写真のみを使用します（サイズ表は生成には使いません・後のサイズ展開用）。
          </s-paragraph>
        </s-section>

        {job.products.map((product) => {
          const images = safeJson<CollectedImage[]>(product.imagesJson, []);
          const { fields: metafields, modelMeta } = readMetafields(
            product.metafieldsJson,
          );
          const sizeChart = safeJson<SizeChartParseResult>(product.sizeChartJson, {
            rows: [],
            unit: null,
            incomplete: true,
            notes: [],
            rawMatches: [],
            source: "none",
          });
          const missing = safeJson<string[]>(product.missingFlagsJson, []);
          const manual = safeJson<{
            reviewNotes?: string;
            sizeChartOverride?: string;
          }>(product.manualEditsJson, {});
          const criticalMissing = missing.includes("images");
          const modelFields = metafields.filter((mf) =>
            /model|モデル|身長|height|body|体型|worn|着用/i.test(
              `${mf.namespace}.${mf.key} ${mf.description || ""}`,
            ),
          );

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
                    <s-stack direction="block" gap="small">
                      <s-text type="strong">不足フラグ</s-text>
                      <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                        {missing.map((flag) => (
                          <li key={flag}>{flagLabel(flag)}</li>
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
                    商品写真がありません。Shopify 商品に画像を追加してから、もう一度「3D作成」でジョブを作り直してください。
                  </s-banner>
                ) : (
                  <s-stack direction="inline" gap="base">
                    {images.map((img, idx) => (
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
                          />
                        </a>
                        <s-paragraph>
                          #{img.position || idx + 1}
                          {img.source ? ` · ${img.source}` : ""}
                        </s-paragraph>
                      </s-box>
                    ))}
                  </s-stack>
                )}

                <s-heading>
                  サイズ表
                  {sizeChart.source ? `（解析: ${sizeChart.source}）` : ""}
                  {sizeChart.unit ? ` / 単位: ${sizeChart.unit}` : ""}
                </s-heading>
                {sizeChart.rows.length > 0 ? (
                  <s-box
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: "13px",
                      }}
                    >
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left", padding: "4px 8px" }}>
                            サイズ
                          </th>
                          {Array.from(
                            new Set(
                              sizeChart.rows.flatMap((r) =>
                                Object.keys(r.measurements || {}),
                              ),
                            ),
                          ).map((key) => (
                            <th
                              key={key}
                              style={{ textAlign: "left", padding: "4px 8px" }}
                            >
                              {key}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sizeChart.rows.map((row) => {
                          const keys = Array.from(
                            new Set(
                              sizeChart.rows.flatMap((r) =>
                                Object.keys(r.measurements || {}),
                              ),
                            ),
                          );
                          return (
                            <tr key={row.size}>
                              <td style={{ padding: "4px 8px" }}>{row.size}</td>
                              {keys.map((key) => (
                                <td key={key} style={{ padding: "4px 8px" }}>
                                  {row.measurements?.[key] ?? "—"}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {sizeChart.notes?.length ? (
                      <s-paragraph>{sizeChart.notes.join(" / ")}</s-paragraph>
                    ) : null}
                  </s-box>
                ) : (
                  <s-banner tone="warning">
                    サイズ表を自動解析できませんでした。下の JSON
                    で手動入力できます（後工程用・3D生成には使いません）。
                  </s-banner>
                )}

                <s-heading>モデル身長・体型（メタフィールド）</s-heading>
                {modelMeta &&
                (modelMeta.heightCm != null ||
                  modelMeta.weightKg != null ||
                  modelMeta.sizeWorn) ? (
                  <s-box
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <s-paragraph>
                      身長: {modelMeta.heightCm ?? "—"} cm ／ 体重:{" "}
                      {modelMeta.weightKg ?? "—"} kg ／ 着用サイズ:{" "}
                      {modelMeta.sizeWorn ?? "—"}
                      {modelMeta.bustCm != null
                        ? ` ／ B ${modelMeta.bustCm}`
                        : ""}
                      {modelMeta.waistCm != null
                        ? ` W ${modelMeta.waistCm}`
                        : ""}
                      {modelMeta.hipCm != null ? ` H ${modelMeta.hipCm}` : ""}
                    </s-paragraph>
                    {modelMeta.sourceKeys?.length ? (
                      <s-paragraph>
                        参照キー: {modelMeta.sourceKeys.join(", ")}
                      </s-paragraph>
                    ) : null}
                  </s-box>
                ) : (
                  <s-paragraph>
                    モデル身長・体型の抽出結果なし
                    {modelMeta?.notes?.length
                      ? `（${modelMeta.notes.join(" / ")}）`
                      : ""}
                  </s-paragraph>
                )}

                <s-heading>
                  メタフィールド一覧（{metafields.length} 件
                  {modelFields.length
                    ? ` / モデル関連 ${modelFields.length}`
                    : ""}
                  ）
                </s-heading>
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  {metafields.length === 0 ? (
                    <s-paragraph>メタフィールドなし</s-paragraph>
                  ) : (
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(
                        (modelFields.length ? modelFields : metafields).slice(
                          0,
                          40,
                        ),
                        null,
                        2,
                      )}
                    </pre>
                  )}
                </s-box>

                <s-heading>手動編集（保存で不足フラグを再計算）</s-heading>
                <Form method="post">
                  <input type="hidden" name="intent" value="save_edits" />
                  <input type="hidden" name="snapshotId" value={product.id} />
                  <s-stack direction="block" gap="base">
                    <s-text-area
                      name="reviewNotes"
                      label="レビューメモ"
                      rows={3}
                      defaultValue={
                        manual.reviewNotes || product.reviewNotes || ""
                      }
                    />
                    <s-text-area
                      name="sizeChartOverride"
                      label="サイズ表の手動補正（JSON: { unit, rows: [{ size, measurements }] }）"
                      rows={10}
                      defaultValue={defaultSizeChartEditorValue(
                        sizeChart,
                        manual.sizeChartOverride,
                      )}
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
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(
                          product.assets.map((a) => ({
                            id: a.id,
                            kind: a.kind,
                            sizeLabel: a.sizeLabel,
                            storageUrl: a.storageUrl,
                            mimeType: a.mimeType,
                          })),
                          null,
                          2,
                        )}
                      </pre>
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
                <s-stack direction="block" gap="small">
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
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {JSON.stringify(
                  job.engineRuns.map((r) => ({
                    id: r.id,
                    status: r.status,
                    externalRunId: r.externalRunId,
                    endpointId: r.endpointId,
                    errorMessage: r.errorMessage,
                    photoOnly: r.photoOnly,
                    assetCount: r.assets?.length ?? 0,
                  })),
                  null,
                  2,
                )}
              </pre>
            </s-box>
          </s-section>
        ) : null}
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
