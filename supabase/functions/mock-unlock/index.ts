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
import { makeCors } from "../_shared/cors.ts";
import { normalizeDomain, validateDomain } from "../_shared/domain.ts";
import { getOrCreateCustomerId } from "../_shared/customer.ts";

interface MockUnlockBody {
  domain?: string;
  email?: string;
  lang?: "es" | "en";
  bypassSecret?: string;
}

const MOCK_AMOUNT_CENTS = 9900; // 99.00 EUR

/** Constant-time string comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = makeCors(req);
  const pf = cors.preflight();
  if (pf) return pf;

  // --- Hard gate #1: dev bypass must be explicitly enabled ----------------
  // In production this whole endpoint is replaced by Stripe (Fase 8). Until then
  // it stays behind BOTH a build-time flag AND a shared secret so a public
  // visitor can browse the landing + free preview but CANNOT unlock a paid scan.
  if (Deno.env.get("DEV_BYPASS_PAYMENT") !== "true") {
    return cors.json({ error: "Not found" }, 403);
  }

  if (req.method !== "POST") {
    return cors.json({ error: "Method not allowed" }, 405);
  }

  // --- Parse body ---------------------------------------------------------
  let body: MockUnlockBody;
  try {
    body = await req.json();
  } catch {
    return cors.json({ error: "Invalid JSON body" }, 400);
  }

  // --- Hard gate #2: shared secret (header x-bypass-secret OR body) --------
  const expectedSecret = Deno.env.get("BYPASS_SECRET") ?? "";
  const providedSecret =
    req.headers.get("x-bypass-secret") ?? body.bypassSecret ?? "";
  if (!expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
    // Same opaque response as the disabled state — don't reveal the gate exists.
    return cors.json({ error: "Not found" }, 403);
  }

  const rawDomain = (body.domain ?? "").toString();
  if (!rawDomain.trim()) {
    return cors.json({ error: "domain is required" }, 400);
  }

  const normalizedDomain = normalizeDomain(rawDomain);
  const validation = validateDomain(normalizedDomain);
  if (!validation.ok) {
    return cors.json(
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

  // --- Canonical customer by email (one user per email; reused if it already
  // exists as a free lead / prior domain) ----------------------------------
  const customerId = await getOrCreateCustomerId(supabase, email, lang);

  // --- Create the scan request (already "paid") ---------------------------
  const { data: scan, error: scanError } = await supabase
    .from("scan_requests")
    .insert({
      domain: rawDomain,
      normalized_domain: normalizedDomain,
      email,
      lang,
      customer_id: customerId,
      status: "paid_pending_verification",
      paid_at: new Date().toISOString(),
    })
    .select("id, normalized_domain, status")
    .single();

  if (scanError || !scan) {
    console.error("mock-unlock: failed to insert scan_request", scanError);
    return cors.json({ error: "Could not create scan request" }, 500);
  }

  // --- Create the mock payment (best-effort link) -------------------------
  const { error: paymentError } = await supabase.from("payments").insert({
    scan_request_id: scan.id,
    amount: MOCK_AMOUNT_CENTS,
    currency: "eur",
    payment_status: "mock_paid",
    customer_email: email,
    customer_id: customerId,
    is_mock: true,
  });

  if (paymentError) {
    // The scan row is what the flow depends on; a missing mock payment row is
    // not fatal for dev. Log it but still return success.
    console.error("mock-unlock: failed to insert payment", paymentError);
  }

  return cors.json(
    {
      scanRequestId: scan.id,
      normalizedDomain: scan.normalized_domain,
      status: scan.status,
    },
    200,
  );
});
