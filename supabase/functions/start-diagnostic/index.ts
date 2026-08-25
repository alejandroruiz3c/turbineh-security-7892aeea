// Edge Function: start-diagnostic
// ---------------------------------------------------------------------------
// Kicks off the external diagnostic for a verified, paid, unconsumed scan and
// returns immediately. The engine runs in the BACKGROUND via
// EdgeRuntime.waitUntil so the HTTP response is fast; when it finishes it stores
// raw_findings + diagnostic_completed_at.
//
// POST { scanRequestId } -> 200 { status }
//
// The background task runs the engine, stores raw_findings, then chains straight
// into AI report generation (generate-ai-report / _shared/report.ts), which
// moves status to 'completed' (or 'failed'). A real run therefore ends at
// 'completed'. The engine step itself never sets 'completed' — the report step
// owns that transition.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { makeCors } from "../_shared/cors.ts";
import { runDiagnostic } from "../_shared/diagnostic.ts";
import { generateReport } from "../_shared/report.ts";
import { checkRateLimit, rateLimitBody } from "../_shared/rateLimit.ts";
import { clientIp } from "../_shared/request.ts";
import {
  budgetReachedBody,
  claimFreeReport,
  releaseAiBudget,
  releaseFreeReportClaim,
  reportLimitBody,
  reserveAiBudget,
  verifiedEmailFor,
} from "../_shared/quota.ts";

// Provided by the Supabase Edge runtime; lets background work outlive the response.
declare const EdgeRuntime:
  | { waitUntil(promise: Promise<unknown>): void }
  | undefined;

interface Body {
  scanRequestId?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // --- Rate limit: per-IP daily cap (the run itself is also idempotent) -----
  const ip = clientIp(req);
  const rlOk = await checkRateLimit(supabase, ip, "start_diagnostic_ip", 20, 86400);
  if (!rlOk) return cors.json(rateLimitBody(), 429);

  const { data: scan, error: scanErr } = await supabase
    .from("scan_requests")
    .select("id, normalized_domain, status, verification_status, report_consumed, lang, email")
    .eq("id", scanRequestId)
    .maybeSingle();

  if (scanErr) {
    console.error("start-diagnostic: scan query failed", scanErr);
    return cors.json({ error: "Internal error" }, 500);
  }
  if (!scan) {
    return cors.json({ error: "Not found" }, 404);
  }

  // Idempotency: never start a second run. If it's already running or done,
  // just report the current status.
  if (scan.status === "processing" || scan.status === "completed") {
    return cors.json({ status: scan.status }, 200);
  }

  // Guard: must be a paid+verified, unconsumed scan.
  if (scan.report_consumed) {
    return cors.json({ error: "This report has already been used" }, 409);
  }
  if (scan.status !== "verified" || scan.verification_status !== "verified") {
    return cors.json(
      { error: "Scan is not verified", status: scan.status },
      409,
    );
  }

  // Guard: don't run if a report already exists for this scan.
  const { data: existingReport, error: repErr } = await supabase
    .from("diagnostic_reports")
    .select("id")
    .eq("scan_request_id", scan.id)
    .maybeSingle();
  if (repErr) {
    console.error("start-diagnostic: report lookup failed", repErr);
    return cors.json({ error: "Internal error" }, 500);
  }
  if (existingReport) {
    return cors.json({ error: "A report already exists for this scan" }, 409);
  }

  const lang: "es" | "en" = scan.lang === "en" ? "en" : "es";

  // --- Guardrail: one free report per VERIFIED email -----------------------
  // Authoritative, and deliberately here: this is the last point before we
  // spend money, and the email has been proven by now (status is 'verified'),
  // which is what makes the limit worth anything. Keyed on the verified address,
  // so switching domains does not buy a second report.
  const verifiedEmail = await verifiedEmailFor(supabase, scan.id, scan.email);
  const claim = await claimFreeReport(
    supabase,
    verifiedEmail ?? "",
    scan.id,
    scan.normalized_domain,
  );
  if (!claim.allowed) {
    if (claim.reason === "internal_error") {
      return cors.json({ error: "Internal error" }, 500);
    }
    return cors.json(reportLimitBody(lang, claim.claimed_domain), 409);
  }

  // --- Guardrail: daily AI budget -----------------------------------------
  // Atomic reservation against today's cap. Serialized in SQL, so concurrent
  // runs cannot both spend the same last dollar.
  const reservation = await reserveAiBudget(supabase, scan.id);
  if (!reservation.allowed) {
    console.warn(
      `start-diagnostic: budget refused scan ${scan.id} (${reservation.spent}/${reservation.cap} USD)`,
    );
    // Give the report slot back — they never got their report.
    await releaseFreeReportClaim(supabase, scan.id);
    return cors.json(budgetReachedBody(lang), 503);
  }

  // From here on, a run that dies without producing a report must hand both the
  // report slot and the reserved budget back.
  const releaseGuardrails = async () => {
    await releaseFreeReportClaim(supabase, scan.id);
    await releaseAiBudget(supabase, scan.id);
  };

  // Flip to processing + stamp start time BEFORE returning.
  const { error: procErr } = await supabase
    .from("scan_requests")
    .update({
      status: "processing",
      diagnostic_started_at: new Date().toISOString(),
    })
    .eq("id", scan.id);
  if (procErr) {
    console.error("start-diagnostic: failed to set processing", procErr);
    await releaseGuardrails();
    return cors.json({ error: "Internal error" }, 500);
  }

  // Background task: run the engine, persist findings, then generate the AI
  // report (which advances status to 'completed', or 'failed' on error).
  const task = (async () => {
    try {
      const rawFindings = await runDiagnostic(scan.normalized_domain);
      await supabase
        .from("scan_requests")
        .update({
          raw_findings: rawFindings,
          diagnostic_completed_at: new Date().toISOString(),
        })
        .eq("id", scan.id);

      // Chain into report generation. status is still 'processing' here, which
      // is exactly what generateReport's guard requires.
      const rep = await generateReport(supabase, scan.id);
      if (!rep.ok) {
        console.error("start-diagnostic: report generation did not complete", rep.body);
      }
    } catch (e) {
      console.error("start-diagnostic: background engine failed", e);
      // The engine died before the AI ran: no report, so no charge and no
      // consumed free slot. (generateReport releases them itself when the
      // failure happens on its side.)
      await releaseGuardrails();
      await supabase
        .from("scan_requests")
        .update({
          raw_findings: {
            schema_version: 1,
            normalized_domain: scan.normalized_domain,
            engine_error: String((e as Error)?.message ?? e).slice(0, 300),
            errors: [{ section: "engine", reason: "unhandled_exception" }],
          },
          diagnostic_completed_at: new Date().toISOString(),
          status: "failed",
        })
        .eq("id", scan.id);
    }
  })();

  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(task);
  } else {
    // Fallback for runtimes without waitUntil (best effort).
    task.catch((e) => console.error("start-diagnostic: task error", e));
  }

  return cors.json({ status: "processing" }, 200);
});
