// Edge Function: verify-domain
// ---------------------------------------------------------------------------
// Second half of the email-at-the-domain flow. The user submits the 6-digit
// code they received; we compare it (salted SHA-256, constant time) against the
// stored verification row and, on success, flip the scan to 'verified'.
//
// SECURITY: the decision is based ONLY on the stored verification row for this
// scan. Any domain/email in the request body is ignored.
//
// POST { scanRequestId, code }
//   -> 200 { verified: true }                                success / idempotent
//   -> 200 { verified: false, reason, attemptsLeft? }        failed / expired / etc.
//   -> 404 { error }                                         scan not found
//   -> 409 { error }                                         scan in a non-verifiable state

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { hashCode, timingSafeEqual } from "../_shared/verification.ts";

interface Body {
  scanRequestId?: string;
  code?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const METHOD = "email_domain";

// States from which verification may proceed.
const VERIFIABLE = new Set([
  "paid_pending_verification",
  "verification_failed",
  "verified",
]);

const MAX_ATTEMPTS = 6;

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const scanRequestId = (body.scanRequestId ?? "").toString().trim();
  if (!UUID_RE.test(scanRequestId)) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  const code = (body.code ?? "").toString().trim();

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // --- Load the scan -------------------------------------------------------
  const { data: scan, error: scanErr } = await supabase
    .from("scan_requests")
    .select("id, status, report_consumed, verification_attempts")
    .eq("id", scanRequestId)
    .maybeSingle();

  if (scanErr) {
    console.error("verify-domain: scan query failed", scanErr);
    return jsonResponse({ error: "Internal error" }, 500);
  }
  if (!scan) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  // --- Guards --------------------------------------------------------------
  if (scan.report_consumed) {
    return jsonResponse({ error: "This report has already been used" }, 409);
  }
  if (!VERIFIABLE.has(scan.status)) {
    return jsonResponse(
      { error: "This scan is not awaiting verification" },
      409,
    );
  }
  if (scan.status === "verified") {
    return jsonResponse({ verified: true }, 200);
  }

  // --- Load the verification row ------------------------------------------
  const { data: dv, error: dvErr } = await supabase
    .from("domain_verifications")
    .select("id, token, expected_value, status, attempts, expires_at")
    .eq("scan_request_id", scan.id)
    .eq("method", METHOD)
    .maybeSingle();

  if (dvErr) {
    console.error("verify-domain: verification query failed", dvErr);
    return jsonResponse({ error: "Internal error" }, 500);
  }
  if (!dv) {
    // No code has been sent yet for this scan.
    return jsonResponse({ verified: false, reason: "no_code" }, 200);
  }

  // Idempotency at the row level too.
  if (dv.status === "verified") {
    return jsonResponse({ verified: true }, 200);
  }

  const now = Date.now();

  // --- Expiry --------------------------------------------------------------
  if (!dv.expires_at || Date.parse(dv.expires_at) <= now) {
    await supabase
      .from("domain_verifications")
      .update({ status: "failed", last_error: "expired" })
      .eq("id", dv.id);
    await supabase
      .from("scan_requests")
      .update({
        status: "verification_failed",
        verification_status: "failed",
        last_verification_error: "expired",
      })
      .eq("id", scan.id);
    return jsonResponse({ verified: false, reason: "expired" }, 200);
  }

  // --- Attempt cap ---------------------------------------------------------
  if ((dv.attempts ?? 0) >= MAX_ATTEMPTS) {
    return jsonResponse(
      { verified: false, reason: "too_many_attempts" },
      200,
    );
  }

  // --- Compare -------------------------------------------------------------
  // Reject malformed codes without consuming an attempt.
  if (!/^\d{6}$/.test(code)) {
    return jsonResponse(
      {
        verified: false,
        reason: "invalid_code",
        attemptsLeft: Math.max(0, MAX_ATTEMPTS - (dv.attempts ?? 0)),
      },
      200,
    );
  }

  const submittedHash = await hashCode(dv.token, code);
  const match = timingSafeEqual(submittedHash, dv.expected_value);

  if (match) {
    const verifiedAt = new Date(now).toISOString();
    const { error: dvUpErr } = await supabase
      .from("domain_verifications")
      .update({ status: "verified", verified_at: verifiedAt, last_error: null })
      .eq("id", dv.id);
    const { error: scanUpErr } = await supabase
      .from("scan_requests")
      .update({
        status: "verified",
        verification_status: "verified",
        verified_at: verifiedAt,
        last_verification_error: null,
      })
      .eq("id", scan.id);

    if (dvUpErr || scanUpErr) {
      console.error("verify-domain: success update failed", dvUpErr, scanUpErr);
      return jsonResponse({ error: "Internal error" }, 500);
    }
    return jsonResponse({ verified: true }, 200);
  }

  // --- Failure: increment counters ----------------------------------------
  const newAttempts = (dv.attempts ?? 0) + 1;
  await supabase
    .from("domain_verifications")
    .update({ attempts: newAttempts, status: "failed", last_error: "invalid_code" })
    .eq("id", dv.id);
  await supabase
    .from("scan_requests")
    .update({
      status: "verification_failed",
      verification_status: "failed",
      verification_attempts: (scan.verification_attempts ?? 0) + 1,
      last_verification_error: "invalid_code",
    })
    .eq("id", scan.id);

  return jsonResponse(
    {
      verified: false,
      reason: "invalid_code",
      attemptsLeft: Math.max(0, MAX_ATTEMPTS - newAttempts),
    },
    200,
  );
});
