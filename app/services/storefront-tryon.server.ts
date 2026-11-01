/**
 * Storefront try-on lookup: resolve latest garment Asset3D for a product.
 * Prefer succeeded job GLB URLs; fall back to sample tee demo asset when missing.
 */

import prisma from "../db.server";
import {
  buildMannequinProportions,
  type MannequinInput,
  type MannequinProportions,
} from "../lib/mannequin";
import {
  SAMPLE_GARMENT_CDN,
  SAMPLE_GARMENT_KIND,
  SAMPLE_GARMENT_MIME,
} from "../lib/sample-garment";

export type GarmentAssetSource = "job" | "sample" | "none";

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
    /** True when URL is missing or is the demo sample (not a live TRELLIS job). */
    placeholder: boolean;
    source: GarmentAssetSource;
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

const LIMITATIONS_BASE = [
  "マネキンは MakeHuman 系メッシュ＋体型カテゴリのプレビューです（写真スキャンではありません）。",
  "サイズ表に基づく S/M/L 着装フィットは未実装です。",
];

function sampleAsset(note: string): NonNullable<StorefrontTryOnResult["asset"]> {
  return {
    id: "sample-tee",
    kind: SAMPLE_GARMENT_KIND,
    sizeLabel: "sample",
    storageUrl: SAMPLE_GARMENT_CDN,
    mimeType: SAMPLE_GARMENT_MIME,
    placeholder: true,
    source: "sample",
  };
}

function withSampleLimitations(extra: string[]): string[] {
  return [
    ...LIMITATIONS_BASE,
    ...extra,
    "本番 TRELLIS GLB が無いためサンプル服メッシュを表示します（Admin「3D作成」で生成すると差し替わります）。",
  ];
}

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
  const mannequin = opts.body ? buildMannequinProportions(opts.body) : undefined;

  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    return {
      productId: numeric,
      productGid: gid,
      title: null,
      handle: null,
      jobStatus: null,
      asset: sampleAsset("no-shop"),
      limitations: withSampleLimitations([
        "このショップの Shop レコードが見つかりません。Admin で一度アプリを開き直してください。",
      ]),
      mannequin,
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
        take: 10,
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
      asset: sampleAsset("no-snapshot"),
      limitations: withSampleLimitations([
        "この商品の 3D アセットはまだありません。Admin の「3D作成」から生成してください。",
      ]),
      mannequin,
    };
  }

  const withUrl = snapshot.assets.filter((a) => a.storageUrl);
  // Prefer non-sample job URLs; skip our own demo CDN if somehow stored.
  const jobUrl =
    withUrl.find(
      (a) =>
        a.storageUrl &&
        !a.storageUrl.includes("/tryon/garments/sample-tee.glb") &&
        a.kind === "base",
    ) ||
    withUrl.find(
      (a) =>
        a.storageUrl && !a.storageUrl.includes("/tryon/garments/sample-tee.glb"),
    ) ||
    null;

  if (jobUrl && jobUrl.storageUrl) {
    return {
      productId: numeric,
      productGid: gid,
      title: snapshot.title,
      handle: snapshot.handle,
      jobStatus: snapshot.job.status,
      asset: {
        id: jobUrl.id,
        kind: jobUrl.kind,
        sizeLabel: jobUrl.sizeLabel,
        storageUrl: jobUrl.storageUrl,
        mimeType: jobUrl.mimeType,
        placeholder: false,
        source: "job",
      },
      limitations: [
        ...LIMITATIONS_BASE,
        snapshot.job.status === "succeeded" || snapshot.job.status === "completed"
          ? "生成ジョブの GLB を人体に重ねて表示しています。"
          : `ジョブ状態: ${snapshot.job.status}（URL 付きアセットを表示中）。`,
      ],
      mannequin,
    };
  }

  return {
    productId: numeric,
    productGid: gid,
    title: snapshot.title,
    handle: snapshot.handle,
    jobStatus: snapshot.job.status,
    asset: sampleAsset("awaiting-glb"),
    limitations: withSampleLimitations([
      `ジョブ状態: ${snapshot.job.status}。RunPod 出力に GLB URL がまだありません。`,
    ]),
    mannequin,
  };
}
