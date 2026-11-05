import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  isRouteErrorResponse,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  createGenerationJob,
  productIdsFromSearchParams,
} from "../services/jobs.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const productIds = productIdsFromSearchParams(url.searchParams);

  return {
    productIds,
    rawQuery: url.search,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const idsRaw = String(form.get("productIds") || "");
  const productIds = idsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const job = await createGenerationJob({
      shopDomain: session.shop,
      productIds,
      admin,
    });
    // Do NOT use authenticate.admin().redirect() or react-router redirect here.
    // On embedded form POSTs (data requests), Shopify's redirect throws 401 +
    // X-Shopify-API-Request-Failure-Reauthorize-Url; App Bridge then sends
    // Navigation.redirect.remote and returns a never-resolving Promise → blank
    // iframe until the merchant hard-reloads. Return the id and navigate in the
    // client with a same-origin document load instead (matches "reload works").
    return { ok: true as const, jobId: job.id, productIds };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ジョブ作成に失敗しました";
    return {
      ok: false as const,
      error: message,
      productIds,
    };
  }
};

/** Keep embedded Admin auth query params across the post-create document load. */
function jobReviewHref(jobId: string): string {
  const next = new URL(`/app/jobs/${jobId}`, window.location.origin);
  const cur = new URLSearchParams(window.location.search);
  for (const key of ["shop", "host", "embedded", "id_token"]) {
    const value = cur.get(key);
    if (value && !next.searchParams.has(key)) {
      next.searchParams.set(key, value);
    }
  }
  return `${next.pathname}${next.search}`;
}

export default function NewGenerationJob() {
  const { productIds, rawQuery } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const ids =
    actionData && "productIds" in actionData
      ? actionData.productIds
      : productIds;

  useEffect(() => {
    if (!actionData || !("jobId" in actionData) || !actionData.ok) return;
    // Full document navigation — same path that already works after reload.
    window.location.assign(jobReviewHref(actionData.jobId));
  }, [actionData]);

  const redirecting =
    Boolean(actionData && "jobId" in actionData && actionData.ok) || busy;

  return (
    <s-page heading="3D作成 — ジョブ開始">
      <s-section heading="選択された商品">
        {actionData && "error" in actionData && actionData.error ? (
          <s-banner tone="critical">{actionData.error}</s-banner>
        ) : null}

        {redirecting ? (
          <s-banner tone="info">
            {actionData && "jobId" in actionData && actionData.ok
              ? "確認画面へ移動しています…"
              : "商品データを収集しています…（画像・メタフィールド・サイズ表）。完了までこのままお待ちください。"}
          </s-banner>
        ) : null}

        {ids.length === 0 ? (
          <s-banner tone="warning">
            商品 ID が渡っていません。商品一覧で商品を選択し、「3D作成」から開いてください。
            {rawQuery ? (
              <s-paragraph>
                受信クエリ: <s-text type="strong">{rawQuery}</s-text>
              </s-paragraph>
            ) : null}
          </s-banner>
        ) : (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              {ids.length}{" "}
              件の商品が選択されています。収集ジョブを作成すると、画像・説明文・メタフィールド・サイズ表を取り込み、確認画面へ進みます。
            </s-paragraph>
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                {ids.map((id) => (
                  <li key={id}>
                    <code>{id}</code>
                  </li>
                ))}
              </ul>
            </s-box>
            <Form method="post">
              <input type="hidden" name="productIds" value={ids.join(",")} />
              <s-button type="submit" variant="primary" disabled={redirecting}>
                {redirecting
                  ? actionData && "jobId" in actionData && actionData.ok
                    ? "移動中…"
                    : "収集中…"
                  : "データを収集して確認画面へ"}
              </s-button>
            </Form>
          </s-stack>
        )}
      </s-section>

      <s-section slot="aside" heading="次のステップ">
        <s-unordered-list>
          <s-list-item>商品画像・メタフィールドの取得</s-list-item>
          <s-list-item>サイズ表の解析</s-list-item>
          <s-list-item>内容確認 →「確認して作成開始」</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    return boundary.error(error);
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    <s-page heading="3D作成 — エラー">
      <s-banner tone="critical">
        ジョブ開始画面の表示に失敗しました。再読み込みするか、商品一覧から「3D作成」をやり直してください。
        {message ? ` (${message})` : ""}
      </s-banner>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
