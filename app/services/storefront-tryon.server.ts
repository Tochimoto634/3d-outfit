/**
 * Storefront try-on lookup: resolve latest garment Asset3D for a product.
 * RunPod/TRELLIS may still be mock — storageUrl can be null (viewer uses cloth proxy).
 */

import prisma from "../db.server";
import {
  buildMannequinProportions,
  type MannequinInput,
  type MannequinProportions,
} from "../lib/mannequin";

export type StorefrontTryOnResult = {
  productId: string;
  productGid: string;
  title: string | null;
  handle: string | null;
  jobStatus: string | null;
  asset: {
    id: string;
    kind: string;
    sizeLabel: string | null;
    storageUrl: string | null;
    mimeType: string | null;
    placeholder: boolean;
  } | null;
  limitations: string[];
  mannequin?: MannequinProportions;
};

function toProductGid(productId: string): string {
  const raw = String(productId || "").trim();
  if (raw.startsWith("gid://shopify/Product/")) return raw;
  const numeric = raw.replace(/\D/g, "");
  if (!numeric) return raw;
  return `gid://shopify/Product/${numeric}`;
}

function toNumericProductId(productId: string): string {
  const raw = String(productId || "").trim();
  if (raw.startsWith("gid://shopify/Product/")) {
    return raw.split("/").pop() || raw;
  }
  return raw.replace(/\D/g, "") || raw;
}

const LIMITATIONS = [
  "TRELLIS / ComfyUI 実生成は未接続（RunPod モック可）。GLB が無い場合は布プロキシで表示します。",
  "マネキンはパラメトリック MVP です（写真スキャン体型ではありません）。",
  "サイズ表に基づく S/M/L 着装フィットは未実装です。",
];

/**
 * Find the newest ProductSnapshot + base Asset3D for this shop/product.
 */
export async function resolveStorefrontTryOn(opts: {
  shopDomain: string;
  productId: string;
  body?: MannequinInput | null;
}): Promise<StorefrontTryOnResult | null> {
  const shopDomain = opts.shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!shopDomain || !opts.productId) return null;

  const gid = toProductGid(opts.productId);
  const numeric = toNumericProductId(opts.productId);

  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    // Shop row may be missing if only Session exists — still allow demo payload
    return {
      productId: numeric,
      productGid: gid,
      title: null,
      handle: null,
      jobStatus: null,
      asset: null,
      limitations: [
        ...LIMITATIONS,
        "このショップの Shop レコードが見つかりません。Admin で一度アプリを開き直してください。",
      ],
      mannequin: opts.body ? buildMannequinProportions(opts.body) : undefined,
    };
  }

  const snapshot = await prisma.productSnapshot.findFirst({
    where: {
      shopifyProductId: { in: [gid, numeric, `gid://shopify/Product/${numeric}`] },
      job: { shopId: shop.id },
    },
    orderBy: { updatedAt: "desc" },
    include: {
      job: true,
      assets: {
        where: { kind: { in: ["base", "preview"] } },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  if (!snapshot) {
    return {
      productId: numeric,
      productGid: gid,
      title: null,
      handle: null,
      jobStatus: null,
      asset: null,
      limitations: [
        ...LIMITATIONS,
        "この商品の 3D アセットはまだありません。Admin の「3D作成」から生成してください。",
      ],
      mannequin: opts.body ? buildMannequinProportions(opts.body) : undefined,
    };
  }

  const asset =
    snapshot.assets.find((a) => a.storageUrl) ||
    snapshot.assets[0] ||
    null;

  return {
    productId: numeric,
    productGid: gid,
    title: snapshot.title,
    handle: snapshot.handle,
    jobStatus: snapshot.job.status,
    asset: asset
      ? {
          id: asset.id,
          kind: asset.kind,
          sizeLabel: asset.sizeLabel,
          storageUrl: asset.storageUrl,
          mimeType: asset.mimeType,
          placeholder: !asset.storageUrl,
        }
      : null,
    limitations: LIMITATIONS,
    mannequin: opts.body ? buildMannequinProportions(opts.body) : undefined,
  };
}
