// Edge Function: mock-unlock
// ---------------------------------------------------------------------------
// DEVELOPMENT ONLY. Simulates a successful payment so we can build and test the
// whole product end-to-end before wiring real Stripe payments (a later phase).
//
// Hard gate: unless DEV_BYPASS_PAYMENT === "true", this returns 403 immediately.
// It must be DEAD in production (never set that secret in prod).
//
// Flow: validate the domain, create a scan_requests row already marked
// 'paid_pending_verification' + paid_at, and a mock payments row linked to it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { normalizeDomain, validateDomain } from "../_shared/domain.ts";

interface MockUnlockBody {
  domain?: string;
  email?: string;
  lang?: "es" | "en";
}

const MOCK_AMOUNT_CENTS = 9900; // 99.00 EUR

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  // --- Hard dev-only gate -------------------------------------------------
  if (Deno.env.get("DEV_BYPASS_PAYMENT") !== "true") {
    return jsonResponse({ error: "Not found" }, 403);
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // --- Parse body ---------------------------------------------------------
  let body: MockUnlockBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const rawDomain = (body.domain ?? "").toString();
  if (!rawDomain.trim()) {
    return jsonResponse({ error: "domain is required" }, 400);
  }

  const normalizedDomain = normalizeDomain(rawDomain);
  const validation = validateDomain(normalizedDomain);
  if (!validation.ok) {
    return jsonResponse(
      { error: "Invalid domain", reason: validation.reason },
      400,
    );
  }

  const lang: "es" | "en" = body.lang === "en" ? "en" : "es";
  const email = body.email?.toString().trim() || null;

  // --- Service-role client (bypasses RLS) ---------------------------------
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // --- Create the scan request (already "paid") ---------------------------
  const { data: scan, error: scanError } = await supabase
    .from("scan_requests")
    .insert({
      domain: rawDomain,
      normalized_domain: normalizedDomain,
      email,
      lang,
      status: "paid_pending_verification",
      paid_at: new Date().toISOString(),
    })
    .select("id, normalized_domain, status")
    .single();

  if (scanError || !scan) {
    console.error("mock-unlock: failed to insert scan_request", scanError);
    return jsonResponse({ error: "Could not create scan request" }, 500);
  }

  // --- Create the mock payment (best-effort link) -------------------------
  const { error: paymentError } = await supabase.from("payments").insert({
    scan_request_id: scan.id,
    amount: MOCK_AMOUNT_CENTS,
    currency: "eur",
    payment_status: "mock_paid",
    customer_email: email,
    is_mock: true,
  });

  if (paymentError) {
    // The scan row is what the flow depends on; a missing mock payment row is
    // not fatal for dev. Log it but still return success.
    console.error("mock-unlock: failed to insert payment", paymentError);
  }

  return jsonResponse(
    {
      scanRequestId: scan.id,
      normalizedDomain: scan.normalized_domain,
      status: scan.status,
    },
    200,
  );
});
