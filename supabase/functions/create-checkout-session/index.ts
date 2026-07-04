// Edge Function: create-checkout-session
// ---------------------------------------------------------------------------
// The ONLY path to a paid scan. Creates a pending scan + Stripe Checkout Session
// and returns { url } for redirect.
//
// POST { domain, email, lang } -> 200 { url }
// CORS locked (makeCors), verify_jwt default (anon key), rate-limited per IP+email.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { makeCors } from "../_shared/cors.ts";
import { normalizeDomain, validateDomain } from "../_shared/domain.ts";
import { getOrCreateCustomerId } from "../_shared/customer.ts";
import { createScanCheckout } from "../_shared/stripe.ts";
import { checkRateLimit, rateLimitBody } from "../_shared/rateLimit.ts";
import { clientIp } from "../_shared/request.ts";

interface Body {
  domain?: string;
  email?: string;
  lang?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = makeCors(req);
  const pf = cors.preflight();
  if (pf) return pf;

  if (req.method !== "POST") return cors.json({ error: "Method not allowed" }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return cors.json({ error: "Invalid JSON body" }, 400);
  }

  const lang: "es" | "en" = body.lang === "en" ? "en" : "es";
  const email = (body.email ?? "").toString().trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return cors.json({ error: "Invalid email" }, 400);
  }
  const rawDomain = (body.domain ?? "").toString();
  const normalizedDomain = normalizeDomain(rawDomain);
  if (!validateDomain(normalizedDomain).ok) {
    return cors.json({ error: "Invalid domain" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // --- Rate limit per IP + per email ---------------------------------------
  const ip = clientIp(req);
  const ipOk = await checkRateLimit(supabase, ip, "checkout_ip", 15, 3600);
  const emailOk = await checkRateLimit(supabase, email, "checkout_email", 8, 3600);
  if (!ipOk || !emailOk) return cors.json(rateLimitBody(lang), 429);

  // --- Canonical customer (one user per email) -----------------------------
  const customerId = await getOrCreateCustomerId(supabase, email, lang);

  // --- Pending scan --------------------------------------------------------
  const { data: scan, error: scanErr } = await supabase
    .from("scan_requests")
    .insert({
      domain: rawDomain,
      normalized_domain: normalizedDomain,
      email,
      lang,
      customer_id: customerId,
      status: "pending_payment",
    })
    .select("id")
    .single();
  if (scanErr || !scan) {
    console.error("create-checkout-session: scan insert failed", scanErr);
    return cors.json({ error: "Could not start checkout" }, 500);
  }

  // --- Stripe Checkout Session ---------------------------------------------
  let session;
  try {
    session = await createScanCheckout({
      scanRequestId: scan.id,
      domain: rawDomain,
      normalizedDomain,
      email,
      lang,
    });
  } catch (e) {
    console.error("create-checkout-session: stripe error", e);
    // Roll the pending scan back so it doesn't linger without a session.
    await supabase.from("scan_requests").delete().eq("id", scan.id);
    return cors.json({ error: "Could not start checkout" }, 502);
  }

  // --- Persist session id + pending payment --------------------------------
  await supabase
    .from("scan_requests")
    .update({ stripe_session_id: session.id })
    .eq("id", scan.id);

  await supabase.from("payments").insert({
    scan_request_id: scan.id,
    customer_id: customerId,
    stripe_session_id: session.id,
    stripe_payment_intent:
      typeof session.payment_intent === "string" ? session.payment_intent : null,
    amount: session.amount_total ?? null,
    currency: session.currency ?? "eur",
    payment_status: "pending",
    customer_email: email,
    is_mock: false,
  });

  return cors.json({ url: session.url }, 200);
});
