import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
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
  // Use Shopify's redirect (not react-router's): embedded Admin form POSTs are
  // data requests, and authenticate.admin's helper preserves shop/host/embedded
  // params and navigates via App Bridge. Plain RR redirect leaves a blank iframe
  // after「3D作成」until a full reload (especially after deploys/merges when SPA
  // chunks are stale).
  const { admin, session, redirect } = await authenticate.admin(request);
  const form = await request.formData();
  const idsRaw = String(form.get("productIds") || "");
  const productIds = idsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let job;
  try {
    job = await createGenerationJob({
      shopDomain: session.shop,
      productIds,
      admin,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ジョブ作成に失敗しました";
    return {
      ok: false as const,
      error: message,
      productIds,
    };
  }

  // Outside try/catch: Shopify redirect may throw a Response for App Bridge.
  return redirect(`/app/jobs/${job.id}`);
};

export default function NewGenerationJob() {
  const { productIds, rawQuery } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const ids = actionData && "productIds" in actionData
    ? actionData.productIds
    : productIds;

  return (
    <s-page heading="3D作成 — ジョブ開始">
      <s-section heading="選択された商品">
        {actionData && "error" in actionData && actionData.error ? (
          <s-banner tone="critical">{actionData.error}</s-banner>
        ) : null}

        {busy ? (
          <s-banner tone="info">
            商品データを収集しています…（画像・メタフィールド・サイズ表）。完了までこのままお待ちください。
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
              <s-button type="submit" variant="primary" disabled={busy}>
                {busy
                  ? "収集中…"
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
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
