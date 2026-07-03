// Shared CORS helpers for all Edge Functions.
//
// For dev we allow any origin ("*"). When we lock this down for production,
// replace ALLOW_ORIGIN with the real site origin (e.g. read an ALLOWED_ORIGIN
// secret) so only the deployed frontend can call these functions.
const ALLOW_ORIGIN = "*";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * If the incoming request is a CORS preflight (OPTIONS), returns a ready-to-send
 * 204 Response. Otherwise returns null so the caller continues normal handling.
 */
export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return null;
}

/** JSON response helper that always includes CORS + content-type headers. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
