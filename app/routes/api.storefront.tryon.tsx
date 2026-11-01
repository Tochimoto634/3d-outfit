/**
 * Public storefront try-on API (CORS).
 * GET/POST ?shop=&product_id=  — returns Asset3D URL (or placeholder flag) + optional mannequin.
 * Prefer App Proxy `/apps/3d-outfit/tryon` in production themes; this route helps local demos.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { corsHeaders, jsonWithCors } from "../lib/cors";
import { parseTryOnBody } from "../lib/mannequin";
import { resolveStorefrontTryOn } from "../services/storefront-tryon.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";
  const productId =
    url.searchParams.get("product_id") ||
    url.searchParams.get("productId") ||
    "";

  if (!shop || !productId) {
    return jsonWithCors(
      request,
      { error: "shop と product_id が必要です。" },
      { status: 400 },
    );
  }

  const result = await resolveStorefrontTryOn({ shopDomain: shop, productId });
  return jsonWithCors(request, {
    ok: true,
    tryOn: result,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const url = new URL(request.url);
  let shop = url.searchParams.get("shop") || "";
  let productId =
    url.searchParams.get("product_id") ||
    url.searchParams.get("productId") ||
    "";

  let bodyRaw: unknown = null;
  const contentType = request.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    bodyRaw = await request.json();
  } else if (contentType.includes("form")) {
    const fd = await request.formData();
    bodyRaw = Object.fromEntries(fd.entries());
  }

  if (bodyRaw && typeof bodyRaw === "object") {
    const o = bodyRaw as Record<string, unknown>;
    shop = String(o.shop || shop || "");
    productId = String(o.product_id || o.productId || productId || "");
  }

  if (!shop || !productId) {
    return jsonWithCors(
      request,
      { error: "shop と product_id が必要です。" },
      { status: 400 },
    );
  }

  const parsed = parseTryOnBody(bodyRaw);
  if (!parsed.ok) {
    return jsonWithCors(request, { error: parsed.error }, { status: 400 });
  }

  const result = await resolveStorefrontTryOn({
    shopDomain: shop,
    productId,
    body: parsed.value,
  });

  return jsonWithCors(request, {
    ok: true,
    tryOn: result,
  });
};
