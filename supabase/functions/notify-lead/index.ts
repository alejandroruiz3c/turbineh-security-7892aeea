// Edge Function: notify-lead
// ---------------------------------------------------------------------------
// Emails an internal lead notification to us (NOTIFY_EMAIL) for every free
// (non-paid — the product is now 100% free) landing event, and records a leads
// row. Fire-and-forget friendly: it validates + rate-limits synchronously, then
// does the insert + email in the BACKGROUND and returns { ok: true }
// immediately, so it never blocks the frontend under load.
//
// POST { type, email?, domain?, lang? }
//   type ∈ {'example_report','domain_submitted','free_diagnosis','turbineh_lead'}
//     example_report   — visitor asked for the sample report          (email)
//     domain_submitted — visitor ran the free landing preview         (domain)
//     free_diagnosis   — visitor started the full free diagnosis      (email+domain)
//                        (server-to-server, fired by start-free-diagnosis)
//     turbineh_lead    — bottom-of-site CTA, wants a TurbineH call    (email)
//
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

const TYPES = new Set([
  "example_report",
  "domain_submitted",
  "free_diagnosis",
  "turbineh_lead",
]);

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

  if (!TYPES.has(type)) {
    return cors.json({ ok: false }, 400);
  }

  // --- Validate per type (cheap; garbage never counts toward the rate limit) --
  let email: string | null = null;
  let domain: string | null = null;

  const needsEmail = type !== "domain_submitted";
  const needsDomain = type === "domain_submitted" || type === "free_diagnosis";

  if (needsEmail) {
    email = (body.email ?? "").toString().trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return cors.json({ ok: false }, 400);
    }
  }
  if (needsDomain) {
    domain = normalizeDomain((body.domain ?? "").toString());
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
  } else if (type === "turbineh_lead") {
    const minOk = await checkRateLimit(supabase, ip, "notify_turbineh_min", 5, 60);
    const dayOk = await checkRateLimit(supabase, ip, "notify_turbineh_day", 40, 86400);
    allowed = minOk && dayOk;
  } else if (type === "free_diagnosis") {
    // Server-to-server from start-free-diagnosis, which already enforces tight
    // per-IP / per-email / per-domain caps. The IP seen here is the Edge
    // runtime's, shared by every caller, so this is only a runaway-loop
    // backstop — not the real abuse gate.
    allowed = await checkRateLimit(supabase, ip, "notify_freediag_day", 2000, 86400);
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
      // Link email-bearing leads to the canonical customer (one user per email).
      const customerId = email
        ? await getOrCreateCustomerId(supabase, email, lang)
        : null;
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
      const lines: [string, string][] = [];

      if (type === "example_report") {
        subject = "Nuevo informe gratis no pago";
        lines.push(["Email", email!]);
      } else if (type === "domain_submitted") {
        subject = "Nuevo dominio gratis no pago";
        lines.push(["Dominio", domain!]);
      } else if (type === "free_diagnosis") {
        subject = "Nuevo diagnóstico gratuito iniciado";
        lines.push(["Dominio", domain!], ["Email", email!]);
      } else {
        subject = "Nuevo lead TurbineH (call)";
        lines.push(["Email", email!]);
      }
      lines.push(["Lang", lang], ["UTC", ts]);

      const text = lines.map(([k, v]) => `${k}: ${v}`).join("\n");
      const html =
        `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#12202F">` +
        `<p><strong>${subject}</strong></p>` +
        `<table style="border-collapse:collapse;font-size:14px">` +
        lines
          .map(
            ([k, v]) =>
              `<tr><td style="padding:3px 12px 3px 0;color:#48607A">${k}</td>` +
              `<td style="padding:3px 0"><strong>${v}</strong></td></tr>`,
          )
          .join("") +
        `</table></div>`;

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
