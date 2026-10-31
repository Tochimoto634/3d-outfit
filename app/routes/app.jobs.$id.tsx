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
  getGenerationJob,
  updateProductManualEdits,
} from "../services/jobs.server";
import { isRunPodMockMode } from "../services/runpod.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const job = await getGenerationJob(params.id!);
  if (!job) {
    throw new Response("Job not found", { status: 404 });
  }

  return {
    job,
    runpodMock: isRunPodMockMode(),
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
    const result = await confirmAndStartGeneration(params.id!);
    return {
      ok: true,
      intent: "confirm_start" as const,
      mock: result.mock,
      runCount: result.runs.length,
    };
  }

  return { ok: false, intent: "unknown" as const };
};

function safeJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export default function GenerationJobPage() {
  const { job, runpodMock } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <s-page heading={job.title || `ジョブ ${job.id}`}>
      <s-stack direction="block" gap="base">
        <s-banner tone={job.status === "failed" ? "critical" : "info"}>
          ステータス: <s-text type="strong">{job.status}</s-text>
          {runpodMock ? " ／ RunPod: モックモード（APIキー未設定）" : " ／ RunPod: ライブ設定あり"}
        </s-banner>

        {actionData && "intent" in actionData && actionData.intent === "confirm_start" && actionData.ok ? (
          <s-banner tone="success">
            作成を開始しました（engine runs: {actionData.runCount}
            {actionData.mock ? ", mock" : ""}）
          </s-banner>
        ) : null}

        <s-section heading="選択商品の収集結果">
          <s-paragraph>
            画像・サイズ表解析・メタフィールドを確認し、不足があれば手動で補完してから作成を開始してください。
            3D 生成自体は写真のみを使用します（サイズ表は生成には使いません）。
          </s-paragraph>
        </s-section>

        {job.products.map((product) => {
          const images = safeJson(product.imagesJson) as Array<{
            id?: string;
            url: string;
            altText?: string;
          }>;
          const metafields = safeJson(product.metafieldsJson) as unknown[];
          const sizeChart = safeJson(product.sizeChartJson);
          const missing = safeJson(product.missingFlagsJson) as string[];
          const manual = safeJson(product.manualEditsJson) as {
            reviewNotes?: string;
            sizeChartOverride?: string;
          };

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
                  <s-banner tone="warning">
                    不足フラグ: {missing.join(", ")}
                  </s-banner>
                ) : (
                  <s-banner tone="success">必須データの欠損フラグなし</s-banner>
                )}

                <s-heading>画像（プレースホルダ表示）</s-heading>
                {images.length === 0 ? (
                  <s-paragraph>画像がありません</s-paragraph>
                ) : (
                  <s-stack direction="inline" gap="base">
                    {images.slice(0, 8).map((img, idx) => (
                      <s-box
                        key={img.id || idx}
                        padding="small"
                        borderWidth="base"
                        borderRadius="base"
                        background="subdued"
                      >
                        {/* eslint-disable-next-line jsx-a11y/alt-text */}
                        <img
                          src={img.url}
                          alt={img.altText || product.title || "product"}
                          width={96}
                          height={96}
                          style={{ objectFit: "cover", display: "block" }}
                        />
                      </s-box>
                    ))}
                    {images.length > 8 ? (
                      <s-paragraph>+{images.length - 8} 枚</s-paragraph>
                    ) : null}
                  </s-stack>
                )}

                <s-heading>サイズ表解析（スタブ）</s-heading>
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(sizeChart, null, 2)}
                  </pre>
                </s-box>

                <s-heading>メタフィールド</s-heading>
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(metafields, null, 2)}
                  </pre>
                </s-box>

                <s-heading>手動編集</s-heading>
                <Form method="post">
                  <input type="hidden" name="intent" value="save_edits" />
                  <input type="hidden" name="snapshotId" value={product.id} />
                  <s-stack direction="block" gap="base">
                    <s-text-area
                      name="reviewNotes"
                      label="レビューメモ"
                      rows={3}
                      defaultValue={manual.reviewNotes || ""}
                    />
                    <s-text-area
                      name="sizeChartOverride"
                      label="サイズ表の手動補正（自由記述 / JSON可）"
                      rows={4}
                      defaultValue={manual.sizeChartOverride || ""}
                    />
                    <s-button type="submit" variant="secondary" disabled={busy}>
                      この商品の手動編集を保存
                    </s-button>
                  </s-stack>
                </Form>
              </s-stack>
            </s-section>
          );
        })}

        <s-section heading="作成開始">
          <Form method="post">
            <input type="hidden" name="intent" value="confirm_start" />
            <s-stack direction="block" gap="base">
              <s-paragraph>
                確認後、RunPod へ写真のみの生成ジョブを投入します（TRELLIS / ComfyUI ワークフローはスタブ）。
              </s-paragraph>
              <s-button
                type="submit"
                variant="primary"
                disabled={busy || job.status === "generating"}
              >
                確認して作成開始
              </s-button>
            </s-stack>
          </Form>
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
                    errorMessage: r.errorMessage,
                    photoOnly: r.photoOnly,
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
