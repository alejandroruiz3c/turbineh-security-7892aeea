// Edge Function: send-verification-code
// ---------------------------------------------------------------------------
// Post-payment DOMAIN VERIFICATION via "email at the domain" (the only method).
//
// The caller picks a full email address ON THE DOMAIN THEY PAID TO ANALYZE
// (e.g. admin@theirdomain.com). We prove authorization the same way CAs do for
// domain-validated certs: send a one-time 6-digit code to that address; only
// someone who controls mail on the domain can read it.
//
// POST { scanRequestId, email }
//   -> 200 { sent: true, maskedEmail }        code generated + emailed
//   -> 200 { alreadyVerified: true }          scan is already verified
//   -> 400 { error, reason }                  bad input / domain mismatch
//   -> 404 { error }                          scan not found
//   -> 409 { error }                          scan in a non-verifiable state
//   -> 429 { error }                          cooldown / hourly cap hit
//
// The code is NEVER returned and NEVER stored in plaintext (salted SHA-256).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { makeCors } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitBody } from "../_shared/rateLimit.ts";
import { clientIp } from "../_shared/request.ts";
import {
  generateSixDigitCode,
  hashCode,
  randomSaltHex,
} from "../_shared/verification.ts";
import { sendEmail } from "../_shared/email.ts";

interface Body {
  scanRequestId?: string;
  email?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Basic email shape: local@domain, single @, no whitespace, plausible TLD.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const METHOD = "email_domain";

// States from which a fresh code may be sent.
const SENDABLE = new Set([
  "paid_pending_verification",
  "verification_failed",
  "verified",
]);

const COOLDOWN_MS = 60_000; // 60s between sends
const WINDOW_MS = 3_600_000; // 1 hour
const MAX_PER_WINDOW = 5; // max 5 sends per hour
const CODE_TTL_MS = 20 * 60_000; // code valid for 20 minutes

/** Mask an email's local part: "admin@x.com" -> "a•••n@x.com". */
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  let masked: string;
  if (local.length <= 2) {
    masked = local.slice(0, 1) + "•";
  } else {
    masked =
      local[0] +
      "•".repeat(Math.min(3, local.length - 2)) +
      local[local.length - 1];
  }
  return `${masked}@${domain}`;
}

/** Bilingual email content for the verification code. */
function buildEmail(code: string, domain: string, lang: "es" | "en") {
  if (lang === "en") {
    return {
      subject: `Your verification code: ${code}`,
      text:
        `Hello,\n\n` +
        `Your verification code for ${domain} is:\n\n` +
        `    ${code}\n\n` +
        `Enter this code to confirm you control this domain. ` +
        `It expires in 20 minutes.\n\n` +
        `If you didn't request this, you can ignore this email.`,
      html:
        `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">` +
        `<p>Hello,</p>` +
        `<p>Your verification code for <strong>${domain}</strong> is:</p>` +
        `<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0;color:#111">${code}</p>` +
        `<p>Enter this code to confirm you control this domain. It expires in <strong>20 minutes</strong>.</p>` +
        `<p style="color:#666;font-size:13px">If you didn't request this, you can safely ignore this email.</p>` +
        `</div>`,
    };
  }
  return {
    subject: `Tu código de verificación: ${code}`,
    text:
      `Hola,\n\n` +
      `Tu código de verificación para ${domain} es:\n\n` +
      `    ${code}\n\n` +
      `Introduce este código para confirmar que controlas este dominio. ` +
      `Caduca en 20 minutos.\n\n` +
      `Si no lo has solicitado, puedes ignorar este correo.`,
    html:
      `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">` +
      `<p>Hola,</p>` +
      `<p>Tu código de verificación para <strong>${domain}</strong> es:</p>` +
      `<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0;color:#111">${code}</p>` +
      `<p>Introduce este código para confirmar que controlas este dominio. Caduca en <strong>20 minutos</strong>.</p>` +
      `<p style="color:#666;font-size:13px">Si no lo has solicitado, puedes ignorar este correo.</p>` +
      `</div>`,
  };
}

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

  const scanRequestId = (body.scanRequestId ?? "").toString().trim();
  if (!UUID_RE.test(scanRequestId)) {
    return cors.json({ error: "Not found" }, 404);
  }

  const email = (body.email ?? "").toString().trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return cors.json(
      { error: "Invalid email", reason: "invalid_email" },
      400,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // --- Load the scan -------------------------------------------------------
  const { data: scan, error: scanErr } = await supabase
    .from("scan_requests")
    .select("id, normalized_domain, status, lang, report_consumed")
    .eq("id", scanRequestId)
    .maybeSingle();

  if (scanErr) {
    console.error("send-verification-code: scan query failed", scanErr);
    return cors.json({ error: "Internal error" }, 500);
  }
  if (!scan) {
    return cors.json({ error: "Not found" }, 404);
  }

  // --- Guards --------------------------------------------------------------
  if (scan.report_consumed) {
    return cors.json({ error: "This report has already been used" }, 409);
  }
  if (!SENDABLE.has(scan.status)) {
    return cors.json(
      { error: "This scan is not awaiting verification" },
      409,
    );
  }
  if (scan.status === "verified") {
    return cors.json({ alreadyVerified: true }, 200);
  }

  // --- CORE SECURITY CHECK: email domain must match the paid domain --------
  const emailDomain = email.slice(email.lastIndexOf("@") + 1);
  if (emailDomain !== scan.normalized_domain.toLowerCase()) {
    return cors.json(
      {
        error: "Email domain does not match",
        reason: "domain_mismatch",
        message:
          scan.lang === "en"
            ? "The email must be on the domain you paid to analyze."
            : "El correo debe pertenecer al dominio que pagaste por analizar.",
      },
      400,
    );
  }

  // --- Abuse rate limits (on top of the per-scan cooldown + hourly cap) -----
  // Per-IP daily cap and per-domain daily cap so nobody can spray codes across
  // many scans/emails for many domains from one host.
  const ip = clientIp(req);
  const lang0: "es" | "en" = scan.lang === "en" ? "en" : "es";
  const ipOk = await checkRateLimit(supabase, ip, "send_code_ip", 30, 86400);
  const domainOk = await checkRateLimit(
    supabase,
    scan.normalized_domain,
    "send_code_domain",
    10,
    86400,
  );
  if (!ipOk || !domainOk) {
    return cors.json(rateLimitBody(lang0), 429);
  }

  // --- Load existing verification row (for rate limiting + upsert) ---------
  const { data: existing, error: exErr } = await supabase
    .from("domain_verifications")
    .select("id, last_sent_at, send_window_started_at, send_count")
    .eq("scan_request_id", scan.id)
    .eq("method", METHOD)
    .maybeSingle();

  if (exErr) {
    console.error("send-verification-code: verification query failed", exErr);
    return cors.json({ error: "Internal error" }, 500);
  }

  const now = Date.now();
  const lang: "es" | "en" = scan.lang === "en" ? "en" : "es";

  // --- Rate limiting -------------------------------------------------------
  let sendCount = 1;
  let windowStart = new Date(now).toISOString();

  if (existing) {
    if (
      existing.last_sent_at &&
      now - Date.parse(existing.last_sent_at) < COOLDOWN_MS
    ) {
      return cors.json(
        {
          error: "Too soon",
          reason: "cooldown",
          message:
            lang === "en"
              ? "Please wait a minute before requesting another code."
              : "Espera un minuto antes de pedir otro código.",
        },
        429,
      );
    }

    if (
      existing.send_window_started_at &&
      now - Date.parse(existing.send_window_started_at) < WINDOW_MS
    ) {
      // Still inside the current hour window.
      if ((existing.send_count ?? 0) >= MAX_PER_WINDOW) {
        return cors.json(
          {
            error: "Too many requests",
            reason: "hourly_limit",
            message:
              lang === "en"
                ? "You've requested too many codes. Please try again later."
                : "Has solicitado demasiados códigos. Inténtalo más tarde.",
          },
          429,
        );
      }
      sendCount = (existing.send_count ?? 0) + 1;
      windowStart = existing.send_window_started_at;
    }
    // else: window expired → reset (sendCount=1, windowStart=now, set above)
  }

  // --- Generate + hash the code -------------------------------------------
  const code = generateSixDigitCode();
  const salt = randomSaltHex();
  const expectedValue = await hashCode(salt, code);
  const nowIso = new Date(now).toISOString();
  const expiresAt = new Date(now + CODE_TTL_MS).toISOString();

  // --- Upsert the verification row (never store the code in plaintext) -----
  const { error: upErr } = await supabase
    .from("domain_verifications")
    .upsert(
      {
        scan_request_id: scan.id,
        domain: scan.normalized_domain,
        method: METHOD,
        token: salt, // per-row salt for the hash
        expected_value: expectedValue, // salted SHA-256 of the code
        target_email: email,
        expires_at: expiresAt,
        status: "pending",
        attempts: 0, // reset verify attempts on a fresh send
        last_error: null,
        verified_at: null,
        last_sent_at: nowIso,
        send_window_started_at: windowStart,
        send_count: sendCount,
      },
      { onConflict: "scan_request_id,method" },
    );

  if (upErr) {
    console.error("send-verification-code: upsert failed", upErr);
    return cors.json({ error: "Internal error" }, 500);
  }

  // Record the chosen method on the scan.
  const { error: methErr } = await supabase
    .from("scan_requests")
    .update({ verification_method: METHOD })
    .eq("id", scan.id);
  if (methErr) {
    console.error("send-verification-code: set method failed", methErr);
    // Non-fatal for the send; continue.
  }

  // --- Send the email ------------------------------------------------------
  const mail = buildEmail(code, scan.normalized_domain, lang);
  const result = await sendEmail({
    to: email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });

  if (!result.ok) {
    // The row is stored; surface a generic failure so the user can retry.
    console.error("send-verification-code: email send failed", result.error);
    return cors.json(
      {
        error: "Could not send the verification email",
        reason: "email_send_failed",
      },
      502,
    );
  }

  return cors.json({ sent: true, maskedEmail: maskEmail(email) }, 200);
});
