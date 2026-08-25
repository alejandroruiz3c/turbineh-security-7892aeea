// Edge Function: start-free-diagnosis
// ---------------------------------------------------------------------------
// THE entry point of the (now 100% FREE) web-exposure diagnosis. Replaces
// create-checkout-session / mock-unlock: there is no payment anywhere anymore.
//
// POST { domain, email, lang } -> 200 { scanRequestId, normalizedDomain, status }
//
// It creates a scan_requests row already in the verification-ready state, so the
// very next step is send-verification-code -> verify-domain. That email-at-the-
// domain check is now the ONLY authorization gate (it is what stops anybody from
// scanning a third-party domain), so it is deliberately left untouched.
//
// NOTE on the status value: we reuse the existing enum member
// 'paid_pending_verification'. It is a purely internal state name that is never
// shown to a user; keeping it avoids an enum migration and keeps every
// downstream function (send-verification-code, verify-domain, start-diagnostic)
// working unchanged.
//
// Because the endpoint is free and public it is the main abuse / AI-cost surface,
// so it is rate-limited on three independent axes: IP, email and domain.
//
// CORS locked (makeCors), verify_jwt default (anon key required).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { makeCors } from "../_shared/cors.ts";
import { normalizeDomain, validateDomain } from "../_shared/domain.ts";
import { getOrCreateCustomerId } from "../_shared/customer.ts";
import { checkRateLimit, rateLimitBody } from "../_shared/rateLimit.ts";
import { clientIp } from "../_shared/request.ts";
import {
  aiBudgetStatus,
  budgetReachedBody,
  hasFreeReportClaim,
  reportLimitBody,
} from "../_shared/quota.ts";

// Provided by the Supabase Edge runtime; lets the notify call outlive the response.
declare const EdgeRuntime:
  | { waitUntil(promise: Promise<unknown>): void }
  | undefined;

interface Body {
  domain?: string;
  email?: string;
  lang?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Fire-and-forget server-to-server notify-lead call. Never awaited by the
 * handler: losing an internal notification must never cost the user their scan.
 */
function fireNotifyLead(
  supabaseUrl: string,
  serviceRoleKey: string,
  payload: Record<string, unknown>,
): void {
  const task = (async () => {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/notify-lead`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.error("start-free-diagnosis: notify-lead returned", res.status);
      }
    } catch (e) {
      console.error("start-free-diagnosis: notify-lead call failed", e);
    }
  })();

  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(task);
  } else {
    task.catch((e) => console.error("start-free-diagnosis: notify error", e));
  }
}

// --- Abuse caps -------------------------------------------------------------
// Tight on purpose: every scan that reaches 'verified' costs us an AI report.
const IP_HOUR_LIMIT = 5;
const IP_DAY_LIMIT = 15;
const EMAIL_DAY_LIMIT = 5;
const DOMAIN_DAY_LIMIT = 3;

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = makeCors(req);
  const pf = cors.preflight();
  if (pf) return pf;

  if (req.method !== "POST") {
    return cors.json({ error: "Method not allowed" }, 405);
  }

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
  const validation = validateDomain(normalizedDomain);
  if (!validation.ok) {
    return cors.json({ error: "Invalid domain", reason: validation.reason }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // --- Rate limit: IP (burst + daily), email/day, domain/day ---------------
  // Checked before any write so garbage never creates rows. Fails open only on
  // an infrastructure error (see checkRateLimit).
  const ip = clientIp(req);
  const [ipHourOk, ipDayOk, emailOk, domainOk] = await Promise.all([
    checkRateLimit(supabase, ip, "free_diag_ip_hour", IP_HOUR_LIMIT, 3600),
    checkRateLimit(supabase, ip, "free_diag_ip_day", IP_DAY_LIMIT, 86400),
    checkRateLimit(supabase, email, "free_diag_email_day", EMAIL_DAY_LIMIT, 86400),
    checkRateLimit(
      supabase,
      normalizedDomain,
      "free_diag_domain_day",
      DOMAIN_DAY_LIMIT,
      86400,
    ),
  ]);
  if (!ipHourOk || !ipDayOk || !emailOk || !domainOk) {
    return cors.json(rateLimitBody(lang), 429);
  }

  // --- Guardrail 1: system-wide daily AI budget ----------------------------
  // Checked here, right after the form is submitted, so the user gets the "come
  // back after 00:00" dialog instead of walking through email verification only
  // to hit a wall. The binding check is the atomic reservation in
  // start-diagnostic; this one is purely for a good, early message.
  const budget = await aiBudgetStatus(supabase);
  if (budget?.exhausted) {
    console.warn(
      `start-free-diagnosis: daily budget exhausted (${budget.spent}/${budget.cap} USD on ${budget.day})`,
    );
    // The visitor is still a lead worth knowing about — tell ourselves we lost
    // one to the cap, then refuse the run.
    fireNotifyLead(supabaseUrl, serviceRoleKey, {
      type: "free_diagnosis",
      email,
      domain: normalizedDomain,
      lang,
      blocked: "daily_budget",
    });
    return cors.json(budgetReachedBody(lang), 503);
  }

  // --- Guardrail 2: one free report per email ------------------------------
  // Advisory at this point (the address is not verified yet), but it catches the
  // common case of the same person coming back, and saves them the verification
  // round-trip. The authoritative claim happens in start-diagnostic against the
  // address they actually proved control of.
  const prior = await hasFreeReportClaim(supabase, email);
  if (prior.claimed) {
    return cors.json(reportLimitBody(lang, prior.claimed_domain), 409);
  }

  // --- Canonical customer (one user per email) -----------------------------
  const customerId = await getOrCreateCustomerId(supabase, email, lang);

  // --- Scan request, straight to the verification-ready state --------------
  const { data: scan, error: scanErr } = await supabase
    .from("scan_requests")
    .insert({
      domain: rawDomain,
      normalized_domain: normalizedDomain,
      email,
      lang,
      customer_id: customerId,
      status: "paid_pending_verification",
    })
    .select("id, normalized_domain, status")
    .single();

  if (scanErr || !scan) {
    console.error("start-free-diagnosis: scan insert failed", scanErr);
    return cors.json({ error: "Could not start the diagnosis" }, 500);
  }

  // --- Notify us of the lead (background; never blocks the user) -----------
  fireNotifyLead(supabaseUrl, serviceRoleKey, {
    type: "free_diagnosis",
    email,
    domain: normalizedDomain,
    lang,
  });

  return cors.json(
    {
      scanRequestId: scan.id,
      normalizedDomain: scan.normalized_domain,
      status: scan.status,
    },
    200,
  );
});
