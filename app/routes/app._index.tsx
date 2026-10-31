import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { isRunPodMockMode } from "../services/runpod.server";
import prisma from "../db.server";
import { ensureShop } from "../services/jobs.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const jobCount = await prisma.generationJob.count({
    where: { shopId: shop.id },
  });

  return {
    shop: session.shop,
    jobCount,
    runpodMock: isRunPodMockMode(),
  };
};

export default function Index() {
  const { shop, jobCount, runpodMock } = useLoaderData<typeof loader>();

  return (
    <s-page heading="3D OUTFIT">
      <s-section heading="アパレル向け 3D 着用確認">
        <s-paragraph>
          商品一覧で商品を選択し、「3D作成」からジョブを開始します。写真をもとに着用サイズ相当の
          3D モデルを生成し、購入前の着用感確認と返品削減を目指します。
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button href="/app/jobs" variant="primary">
            ジョブ一覧 ({jobCount})
          </s-button>
          <s-button href="/app/jobs/new" variant="secondary">
            手動でジョブ開始
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="使い方">
        <s-ordered-list>
          <s-list-item>Shopify 管理画面の商品一覧で対象商品を選択</s-list-item>
          <s-list-item>一括操作 / More actions から「3D作成」</s-list-item>
          <s-list-item>画像・サイズ表・メタフィールドを確認・補完</s-list-item>
          <s-list-item>「確認して作成開始」で RunPod 生成ジョブを投入</s-list-item>
        </s-ordered-list>
      </s-section>

      <s-section slot="aside" heading="接続状態">
        <s-paragraph>
          Shop: <s-text type="strong">{shop}</s-text>
        </s-paragraph>
        <s-paragraph>
          RunPod:{" "}
          <s-text type="strong">
            {runpodMock ? "モック（APIキー未設定）" : "ライブ設定あり"}
          </s-text>
        </s-paragraph>
        <s-paragraph>
          <Link to="/app/jobs">Generation jobs</Link>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
