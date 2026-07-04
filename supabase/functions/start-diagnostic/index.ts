// Edge Function: start-diagnostic
// ---------------------------------------------------------------------------
// Kicks off the external diagnostic for a verified, paid, unconsumed scan and
// returns immediately. The engine runs in the BACKGROUND via
// EdgeRuntime.waitUntil so the HTTP response is fast; when it finishes it stores
// raw_findings + diagnostic_completed_at.
//
// POST { scanRequestId } -> 200 { status }
//
// IMPORTANT: on completion the status is intentionally LEFT as 'processing'. The
// next phase (AI report generation) reads raw_findings, produces the report, and
// moves status to 'completed'. Do not flip to 'completed' here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { runDiagnostic } from "../_shared/diagnostic.ts";

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: scan, error: scanErr } = await supabase
    .from("scan_requests")
    .select("id, normalized_domain, status, verification_status, report_consumed")
    .eq("id", scanRequestId)
    .maybeSingle();

  if (scanErr) {
    console.error("start-diagnostic: scan query failed", scanErr);
    return jsonResponse({ error: "Internal error" }, 500);
  }
  if (!scan) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  // Idempotency: never start a second run. If it's already running or done,
  // just report the current status.
  if (scan.status === "processing" || scan.status === "completed") {
    return jsonResponse({ status: scan.status }, 200);
  }

  // Guard: must be a paid+verified, unconsumed scan.
  if (scan.report_consumed) {
    return jsonResponse({ error: "This report has already been used" }, 409);
  }
  if (scan.status !== "verified" || scan.verification_status !== "verified") {
    return jsonResponse(
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
    return jsonResponse({ error: "Internal error" }, 500);
  }
  if (existingReport) {
    return jsonResponse({ error: "A report already exists for this scan" }, 409);
  }

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
    return jsonResponse({ error: "Internal error" }, 500);
  }

  // Background task: run the engine, then persist findings. Status stays
  // 'processing' (see header note) — the report phase advances it to 'completed'.
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
    } catch (e) {
      console.error("start-diagnostic: background engine failed", e);
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

  return jsonResponse({ status: "processing" }, 200);
});
