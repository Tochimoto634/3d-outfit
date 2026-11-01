/** Minimal CORS helpers for storefront / theme block fetch. */

const DEFAULT_ALLOW_HEADERS = "Content-Type, Accept";

export function corsHeaders(request: Request, extra?: HeadersInit): Headers {
  const origin = request.headers.get("Origin") || "*";
  const headers = new Headers(extra);
  // Storefront themes are on *.myshopify.com / custom domains — reflect Origin when present.
  headers.set("Access-Control-Allow-Origin", origin === "null" ? "*" : origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", DEFAULT_ALLOW_HEADERS);
  headers.set("Access-Control-Max-Age", "86400");
  if (origin && origin !== "*") {
    headers.set("Vary", "Origin");
  }
  return headers;
}

export function jsonWithCors(request: Request, data: unknown, init?: ResponseInit) {
  const headers = corsHeaders(request, init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}
