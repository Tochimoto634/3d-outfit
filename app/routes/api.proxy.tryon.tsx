/**
 * App Proxy entry: storefront calls `/apps/3d-outfit/tryon`
 * → Shopify forwards to `{application_url}/api/proxy/tryon` with signature.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { parseTryOnBody } from "../lib/mannequin";
import { authenticate } from "../shopify.server";
import { resolveStorefrontTryOn } from "../services/storefront-tryon.server";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  });
}

async function handle(request: Request) {
  const context = await authenticate.public.appProxy(request);
  const url = new URL(request.url);

  const shop =
    ("session" in context && context.session?.shop) ||
    url.searchParams.get("shop") ||
    "";

  let productId =
    url.searchParams.get("product_id") ||
    url.searchParams.get("productId") ||
    "";

  let bodyRaw: unknown = null;
  if (request.method === "POST") {
    const contentType = request.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) {
      bodyRaw = await request.json();
    } else {
      const fd = await request.formData();
      bodyRaw = Object.fromEntries(fd.entries());
    }
    if (bodyRaw && typeof bodyRaw === "object") {
      const o = bodyRaw as Record<string, unknown>;
      productId = String(o.product_id || o.productId || productId || "");
    }
  }

  if (!shop || !productId) {
    return json(
      { error: "shop と product_id が必要です。" },
      { status: 400 },
    );
  }

  let body = null;
  if (bodyRaw) {
    const parsed = parseTryOnBody(bodyRaw);
    if (!parsed.ok) {
      return json({ error: parsed.error }, { status: 400 });
    }
    body = parsed.value;
  }

  const result = await resolveStorefrontTryOn({
    shopDomain: shop,
    productId,
    body,
  });

  return json({ ok: true, tryOn: result });
}

export const loader = async ({ request }: LoaderFunctionArgs) => handle(request);
export const action = async ({ request }: ActionFunctionArgs) => handle(request);
