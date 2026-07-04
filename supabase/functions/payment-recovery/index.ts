// Edge Function: payment-recovery   (invoked by the daily pg_cron job)
// ---------------------------------------------------------------------------
// Requires the CRON_SECRET header so ONLY cron can call it. Finds unpaid scans
// still inside the 7-day / 7-email window and sends the next recovery email to
// each (atomic claim via claim_recovery_email, shared with the immediate retry).
//
// POST (header x-cron-secret: <CRON_SECRET>) -> 200 { ok, sent }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { sendEmail } from "../_shared/email.ts";
import { buildRecoveryEmail } from "../_shared/recoveryEmail.ts";

const MIN_GAP_SECS = 82800; // ~23h
const MAX_EMAILS = 7;
const MAX_AGE_DAYS = 7;
const BATCH = 500;
const CONCURRENCY = 5;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expected = Deno.env.get("CRON_SECRET") ?? "";
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!expected || !timingSafeEqual(provided, expected)) {
    return json({ error: "forbidden" }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const now = Date.now();
  const cutoff23h = new Date(now - MIN_GAP_SECS * 1000).toISOString();
  const cutoff7d = new Date(now - MAX_AGE_DAYS * 86400 * 1000).toISOString();
  const base = supabaseUrl.replace(/\/+$/, "");

  // Candidate scans (the atomic claim re-checks each one).
  const { data: candidates, error } = await supabase
    .from("scan_requests")
    .select("id")
    .eq("status", "pending_payment")
    .eq("recovery_stopped", false)
    .not("email", "is", null)
    .lt("recovery_emails_sent", MAX_EMAILS)
    .gte("created_at", cutoff7d)
    .or(`last_recovery_email_at.is.null,last_recovery_email_at.lt.${cutoff23h}`)
    .limit(BATCH);

  if (error) {
    console.error("payment-recovery: query failed", error);
    return json({ ok: false }, 200); // never surface internals loudly
  }

  const ids: string[] = (candidates ?? []).map((c: { id: string }) => c.id);
  let sent = 0;

  async function processOne(scanId: string) {
    const { data, error: cErr } = await supabase.rpc("claim_recovery_email", {
      p_scan_id: scanId,
      p_min_gap_secs: MIN_GAP_SECS,
      p_max_emails: MAX_EMAILS,
      p_max_age_days: MAX_AGE_DAYS,
    });
    if (cErr) return;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return; // claimed by someone else / no longer eligible
    const lang: "es" | "en" = row.lang === "en" ? "en" : "es";
    const resumeUrl = `${base}/functions/v1/resume-checkout?scanRequestId=${row.id}`;
    const mail = buildRecoveryEmail(row.recovery_emails_sent, row.normalized_domain, lang, resumeUrl);
    const res = await sendEmail({ to: row.email, subject: mail.subject, html: mail.html, text: mail.text });
    if (res.ok) sent++;
    else console.error("payment-recovery: send failed", res.error);
  }

  // Bounded concurrency.
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    await Promise.all(ids.slice(i, i + CONCURRENCY).map(processOne));
  }

  // Stop scans that have exhausted the cap or aged out (so they're never picked again).
  await supabase
    .from("scan_requests")
    .update({ recovery_stopped: true })
    .eq("status", "pending_payment")
    .eq("recovery_stopped", false)
    .or(`recovery_emails_sent.gte.${MAX_EMAILS},created_at.lt.${cutoff7d}`);

  return json({ ok: true, candidates: ids.length, sent }, 200);
});
