// Edge Function: notify-lead
// ---------------------------------------------------------------------------
// Emails an internal lead notification to us (NOTIFY_EMAIL) for two FREE, non-paid
// landing events, and records a leads row. Fire-and-forget friendly: it validates
// + rate-limits synchronously, then does the insert + email in the BACKGROUND and
// returns { ok: true } immediately, so it never blocks the frontend under load.
//
// POST { type, email?, domain?, lang? }   type ∈ {'example_report','domain_submitted'}
//   -> 200 { ok: true }        accepted (email/insert happen in the background)
//   -> 400 { ok: false }       invalid email / invalid domain / bad type
//   -> 429 { ok: false }       per-IP rate limit exceeded (NO email sent)
//
// Internal subjects are intentionally in Spanish regardless of visitor lang.
// CORS is restricted (makeCors). Internal errors are never leaked.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { makeCors } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { clientIp, hashIp } from "../_shared/request.ts";
import { normalizeDomain, validateDomain } from "../_shared/domain.ts";
import { sendEmail } from "../_shared/email.ts";
import { getOrCreateCustomerId } from "../_shared/customer.ts";

// Provided by the Supabase Edge runtime; lets the insert+email outlive the response.
declare const EdgeRuntime:
  | { waitUntil(promise: Promise<unknown>): void }
  | undefined;

interface Body {
  type?: string;
  email?: string;
  domain?: string;
  lang?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = makeCors(req);
  const pf = cors.preflight();
  if (pf) return pf;

  if (req.method !== "POST") {
    return cors.json({ ok: false }, 405);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return cors.json({ ok: false }, 400);
  }

  const type = (body.type ?? "").toString().trim();
  const lang: "es" | "en" = body.lang === "en" ? "en" : "es";

  if (type !== "example_report" && type !== "domain_submitted") {
    return cors.json({ ok: false }, 400);
  }

  // --- Validate per type (cheap; garbage never counts toward the rate limit) --
  let email: string | null = null;
  let domain: string | null = null;

  if (type === "example_report") {
    email = (body.email ?? "").toString().trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return cors.json({ ok: false }, 400);
    }
  } else {
    const raw = (body.domain ?? "").toString();
    domain = normalizeDomain(raw);
    if (!validateDomain(domain).ok) {
      return cors.json({ ok: false }, 400);
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // --- Rate limit per client IP (protect our inbox). 429 sends NO email. -----
  const ip = clientIp(req);
  let allowed = true;
  if (type === "domain_submitted") {
    const minOk = await checkRateLimit(supabase, ip, "notify_domain_min", 10, 60);
    const dayOk = await checkRateLimit(supabase, ip, "notify_domain_day", 200, 86400);
    allowed = minOk && dayOk;
  } else {
    allowed = await checkRateLimit(supabase, ip, "notify_example_min", 5, 60);
  }
  if (!allowed) {
    return cors.json({ ok: false }, 429);
  }

  // --- Background: record the lead + email us. Never blocks the response. -----
  const task = (async () => {
    try {
      const ipHash = await hashIp(ip);
      // Link example_report leads to the canonical customer (one user per email).
      const customerId =
        type === "example_report" ? await getOrCreateCustomerId(supabase, email, lang) : null;
      await supabase.from("leads").insert({
        type,
        email,
        domain,
        lang,
        ip_hash: ipHash,
        customer_id: customerId,
      });

      const notifyTo = Deno.env.get("NOTIFY_EMAIL");
      if (!notifyTo) {
        console.error("notify-lead: NOTIFY_EMAIL not set; skipping email");
        return;
      }
      const ts = new Date().toISOString();

      let subject: string;
      let text: string;
      let html: string;
      if (type === "example_report") {
        subject = "Nuevo informe gratis no pago";
        text = `Email: ${email}\nLang: ${lang}\nUTC: ${ts}`;
        html =
          `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#12202F">` +
          `<p><strong>Nuevo informe gratis (no pago)</strong></p>` +
          `<p>Email: <strong>${email}</strong></p>` +
          `<p>Lang: ${lang}<br>UTC: ${ts}</p></div>`;
      } else {
        subject = "Nuevo dominio gratis no pago";
        text = `Dominio: ${domain}\nLang: ${lang}\nUTC: ${ts}`;
        html =
          `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#12202F">` +
          `<p><strong>Nuevo dominio gratis (no pago)</strong></p>` +
          `<p>Dominio: <strong>${domain}</strong></p>` +
          `<p>Lang: ${lang}<br>UTC: ${ts}</p></div>`;
      }

      const res = await sendEmail({ to: notifyTo, subject, html, text });
      if (!res.ok) console.error("notify-lead: email send failed", res.error);
    } catch (e) {
      // Swallow — this is fire-and-forget; never surface internals.
      console.error("notify-lead: background task error", e);
    }
  })();

  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(task);
  } else {
    task.catch((e) => console.error("notify-lead: task error", e));
  }

  return cors.json({ ok: true }, 200);
});
