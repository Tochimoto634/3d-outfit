import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { redirect, useLoaderData, Form } from "react-router";
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

  const job = await createGenerationJob({
    shopDomain: session.shop,
    productIds,
    admin,
  });

  return redirect(`/app/jobs/${job.id}`);
};

export default function NewGenerationJob() {
  const { productIds, rawQuery } = useLoaderData<typeof loader>();

  return (
    <s-page heading="3D作成 — ジョブ開始">
      <s-section heading="選択された商品">
        {productIds.length === 0 ? (
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
              {productIds.length} 件の商品が選択されています。収集ジョブを作成すると、画像・説明文・メタフィールド・サイズ表（スタブ解析）を取り込み、確認画面へ進みます。
            </s-paragraph>
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                {productIds.map((id) => (
                  <li key={id}>
                    <code>{id}</code>
                  </li>
                ))}
              </ul>
            </s-box>
            <Form method="post">
              <input
                type="hidden"
                name="productIds"
                value={productIds.join(",")}
              />
              <s-button type="submit" variant="primary">
                データを収集して確認画面へ
              </s-button>
            </Form>
          </s-stack>
        )}
      </s-section>

      <s-section slot="aside" heading="次のステップ">
        <s-unordered-list>
          <s-list-item>商品画像・メタフィールドの取得</s-list-item>
          <s-list-item>サイズ表の解析（スタブ）</s-list-item>
          <s-list-item>内容確認 →「確認して作成開始」</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
