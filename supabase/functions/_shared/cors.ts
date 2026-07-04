// Shared CORS helpers — locked down for the public production deploy.
// ---------------------------------------------------------------------------
// The Access-Control-Allow-Origin is reflected back ONLY when the request's
// Origin is on the allowlist:
//   * https://security.turbineh.com          (production)
//   * *.lovable.app / *.lovableproject.com / *.lovable.dev   (QA previews)
//   * anything in the ALLOWED_ORIGINS secret  (comma-separated, optional)
// Any other origin gets the production origin back, so a browser on a random
// site cannot read our responses. (CORS is browser-only; server-side abuse is
// handled by BYPASS_SECRET + rate limiting.)

const PRIMARY_ORIGIN = "https://security.turbineh.com";

const ALLOW_PATTERNS: RegExp[] = [
  /^https:\/\/security\.turbineh\.com$/,
  /^https:\/\/([a-z0-9-]+\.)*lovable\.app$/,
  /^https:\/\/([a-z0-9-]+\.)*lovableproject\.com$/,
  /^https:\/\/([a-z0-9-]+\.)*lovable\.dev$/,
];

function extraOrigins(): string[] {
  return (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (extraOrigins().includes(origin)) return true;
  return ALLOW_PATTERNS.some((re) => re.test(origin));
}

function headersFor(origin: string | null): Record<string, string> {
  const allow = isAllowedOrigin(origin) ? origin! : PRIMARY_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-bypass-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export interface Cors {
  headers: Record<string, string>;
  /** 204 for an OPTIONS preflight, otherwise null. */
  preflight(): Response | null;
  /** JSON response with the resolved CORS headers. */
  json(body: unknown, status?: number): Response;
}

/** Build a per-request CORS responder that reflects the allowed origin. */
export function makeCors(req: Request): Cors {
  const headers = headersFor(req.headers.get("Origin"));
  return {
    headers,
    preflight() {
      return req.method === "OPTIONS"
        ? new Response(null, { status: 204, headers })
        : null;
    },
    json(body: unknown, status = 200) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    },
  };
}

// --- Backwards-compatible shims (default to the production origin) ----------
// Prefer makeCors(req) in new/updated functions so QA previews are reflected.
export const corsHeaders = headersFor(null);

export function handleCorsPreflight(req: Request): Response | null {
  return makeCors(req).preflight();
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
