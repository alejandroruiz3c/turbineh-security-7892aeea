// Edge Function: get-scan
// ---------------------------------------------------------------------------
// Lets the frontend read the state of a scan for the /verify, /processing and
// /report pages. Returns ONLY safe, whitelisted fields — never tokens,
// verification secrets, internal errors, emails, or Stripe identifiers.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";

interface GetScanBody {
  scanRequestId?: string;
}

// Basic UUID shape check so we don't hand garbage to Postgres.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: GetScanBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const scanRequestId = (body.scanRequestId ?? "").toString().trim();
  if (!UUID_RE.test(scanRequestId)) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Select only the safe columns the frontend is allowed to see.
  const { data, error } = await supabase
    .from("scan_requests")
    .select(
      "id, normalized_domain, status, verification_status, lang, report_consumed",
    )
    .eq("id", scanRequestId)
    .maybeSingle();

  if (error) {
    // Do not leak internal error details to the client.
    console.error("get-scan: query failed", error);
    return jsonResponse({ error: "Internal error" }, 500);
  }

  if (!data) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  return jsonResponse(
    {
      id: data.id,
      normalized_domain: data.normalized_domain,
      status: data.status,
      verification_status: data.verification_status,
      lang: data.lang,
      report_consumed: data.report_consumed,
    },
    200,
  );
});
