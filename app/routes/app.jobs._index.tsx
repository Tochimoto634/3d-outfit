import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/jobs.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const jobs = await prisma.generationJob.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { _count: { select: { products: true, engineRuns: true } } },
  });
  return { jobs };
};

export default function JobsIndex() {
  const { jobs } = useLoaderData<typeof loader>();

  return (
    <s-page heading="3D作成ジョブ">
      <s-section heading="最近のジョブ">
        {jobs.length === 0 ? (
          <s-paragraph>
            まだジョブがありません。商品一覧で商品を選択し、「3D作成」から開始してください。
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {jobs.map((job) => (
              <s-box
                key={job.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small">
                  <s-heading>
                    <Link to={`/app/jobs/${job.id}`}>
                      {job.title || job.id}
                    </Link>
                  </s-heading>
                  <s-paragraph>
                    status={job.status} ／ products={job._count.products} ／
                    runs={job._count.engineRuns}
                  </s-paragraph>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
