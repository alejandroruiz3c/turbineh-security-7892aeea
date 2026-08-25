// Retired-endpoint helper.
// ---------------------------------------------------------------------------
// The product became a 100% free lead magnet, so the whole payment layer
// (Stripe Checkout, the webhook, the abandoned-payment recovery) was taken out
// of the live path. The functions are kept deployed but INERT so any stale
// frontend / bookmarked link / third-party caller gets an explicit, cacheable
// "410 Gone" instead of a confusing 404 or, worse, a working charge.
//
// The original implementations remain in git history (commit 174b0fb, "Phase 8")
// if payments ever come back.

const GONE_BODY = {
  error: "gone",
  message:
    "This endpoint has been retired. The web exposure diagnosis is now free — " +
    "use start-free-diagnosis instead.",
};

/** 410 Gone with permissive CORS (it carries no data worth protecting). */
export function goneResponse(): Response {
  return new Response(JSON.stringify(GONE_BODY), {
    status: 410,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, stripe-signature",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/** Serve nothing but 410 (204 on preflight). Logs each hit so we can spot callers. */
export function serveGone(name: string): void {
  Deno.serve((req: Request): Response => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: goneResponse().headers });
    }
    console.warn(`${name}: retired endpoint called (410)`, req.method);
    return goneResponse();
  });
}
