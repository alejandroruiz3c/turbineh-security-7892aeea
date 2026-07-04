// Edge Function: get-report
// ---------------------------------------------------------------------------
// Returns the finished diagnostic report to the frontend, ONLY when the scan is
// status='completed'. Reassembles the full report from the diagnostic_reports
// columns. Never leaks internal fields (ai_cost, raw errors, tokens, etc.).
//
// POST { scanRequestId }
//   -> 200 { report..., domain, lang, overall_score, risk_level }   if completed
//   -> 404 { error, status? }                                        otherwise

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";

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
    .select("id, status")
    .eq("id", scanRequestId)
    .maybeSingle();

  if (scanErr) {
    console.error("get-report: scan query failed", scanErr);
    return jsonResponse({ error: "Internal error" }, 500);
  }
  if (!scan) {
    return jsonResponse({ error: "Not found" }, 404);
  }
  if (scan.status !== "completed") {
    // Not ready — surface the status so the UI can keep polling, but no content.
    return jsonResponse({ error: "Report not ready", status: scan.status }, 404);
  }

  const { data: report, error: repErr } = await supabase
    .from("diagnostic_reports")
    .select(
      "domain, lang, overall_score, risk_level, executive_summary, findings_json, action_plan_json, ai_prompts_json, model_used",
    )
    .eq("scan_request_id", scan.id)
    .maybeSingle();

  if (repErr) {
    console.error("get-report: report query failed", repErr);
    return jsonResponse({ error: "Internal error" }, 500);
  }
  if (!report) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  const extra = report.ai_prompts_json ?? {};

  // Reassemble the full, self-describing report (no internal fields).
  return jsonResponse(
    {
      domain: report.domain,
      lang: report.lang,
      overall_score: report.overall_score,
      risk_level: report.risk_level,
      model_used: report.model_used,
      report: {
        executive_summary: report.executive_summary,
        overall_verdict: extra.overall_verdict ?? null,
        top_priorities: extra.top_priorities ?? [],
        start_with_claude: extra.start_with_claude ?? null,
        findings: report.findings_json ?? [],
        action_plan: report.action_plan_json ?? null,
        final_checklist: extra.final_checklist ?? [],
        when_to_get_help: extra.when_to_get_help ?? null,
        disclaimer: extra.disclaimer ?? null,
      },
    },
    200,
  );
});
