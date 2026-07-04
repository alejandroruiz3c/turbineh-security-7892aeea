// Edge Function: resume-checkout   (deploy with --no-verify-jwt)
// ---------------------------------------------------------------------------
// Link target in recovery emails. GET ?scanRequestId=... :
//   - unpaid  -> create a fresh Checkout Session and 302 to Stripe
//   - paid    -> 302 to SITE_URL/verify/{id}
// Rate-limited per IP. Never leaks internals.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { createScanCheckout } from "../_shared/stripe.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { clientIp } from "../_shared/request.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAID_STATES = new Set([
  "paid_pending_verification",
  "verification_failed",
  "verified",
  "processing",
  "completed",
]);

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const siteUrl = (Deno.env.get("SITE_URL") || "https://security.turbineh.com").replace(/\/+$/, "");

  const url = new URL(req.url);
  const scanRequestId = (url.searchParams.get("scanRequestId") ?? "").trim();
  if (!UUID_RE.test(scanRequestId)) return redirect(`${siteUrl}/`);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const ip = clientIp(req);
  const rlOk = await checkRateLimit(supabase, ip, "resume_checkout_ip", 20, 3600);
  if (!rlOk) return redirect(`${siteUrl}/?ratelimited=1`);

  const { data: scan } = await supabase
    .from("scan_requests")
    .select("id, domain, normalized_domain, email, lang, status")
    .eq("id", scanRequestId)
    .maybeSingle();
  if (!scan) return redirect(`${siteUrl}/`);

  const lang: "es" | "en" = scan.lang === "en" ? "en" : "es";

  // Already paid? Send them into the verification flow.
  if (PAID_STATES.has(scan.status)) {
    return redirect(`${siteUrl}/verify/${scan.id}?lang=${lang}`);
  }

  // Unpaid but no email on file — nothing to resume against; back to landing.
  if (!scan.email) return redirect(`${siteUrl}/`);

  try {
    const session = await createScanCheckout({
      scanRequestId: scan.id,
      domain: scan.domain,
      normalizedDomain: scan.normalized_domain,
      email: scan.email,
      lang,
    });
    await supabase
      .from("scan_requests")
      .update({ stripe_session_id: session.id })
      .eq("id", scan.id);
    await supabase.from("payments").insert({
      scan_request_id: scan.id,
      stripe_session_id: session.id,
      amount: session.amount_total ?? null,
      currency: session.currency ?? "eur",
      payment_status: "pending",
      customer_email: scan.email,
      is_mock: false,
    });
    if (session.url) return redirect(session.url);
  } catch (e) {
    console.error("resume-checkout: stripe error", e);
  }
  return redirect(`${siteUrl}/`);
});
