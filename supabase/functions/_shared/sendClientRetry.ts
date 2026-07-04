// Immediate client retry email (recovery email #1) on any non-success.
// ---------------------------------------------------------------------------
// Atomically claims a recovery slot (claim_recovery_email) so it counts as an
// email in the 7-day sequence and never duplicates with the daily cron (shared
// ~24h gap + 7-email / 7-day caps). Does nothing if the scan is already paid,
// stopped, or was emailed within the gap.

import { sendEmail } from "./email.ts";
import { buildRecoveryEmail } from "./recoveryEmail.ts";

const MIN_GAP_SECS = 82800; // ~23h (slack so the daily cron reliably re-fires)
const MAX_EMAILS = 7;
const MAX_AGE_DAYS = 7;

// deno-lint-ignore no-explicit-any
export async function sendClientRetry(
  supabase: any,
  scanRequestId: string,
): Promise<{ sent: boolean }> {
  const { data, error } = await supabase.rpc("claim_recovery_email", {
    p_scan_id: scanRequestId,
    p_min_gap_secs: MIN_GAP_SECS,
    p_max_emails: MAX_EMAILS,
    p_max_age_days: MAX_AGE_DAYS,
  });
  if (error) {
    console.error("sendClientRetry: claim rpc failed", error);
    return { sent: false };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { sent: false }; // not eligible (paid / stopped / too soon)

  const lang: "es" | "en" = row.lang === "en" ? "en" : "es";
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const resumeUrl = `${base}/functions/v1/resume-checkout?scanRequestId=${row.id}`;
  const mail = buildRecoveryEmail(row.recovery_emails_sent, row.normalized_domain, lang, resumeUrl);

  const res = await sendEmail({
    to: row.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
  if (!res.ok) console.error("sendClientRetry: email send failed", res.error);
  return { sent: res.ok };
}
