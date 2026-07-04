// Edge Function: run-diagnostic
// ---------------------------------------------------------------------------
// Runs the external, non-invasive diagnostic engine for a given scan and writes
// the structured result to scan_requests.raw_findings. This is the engine
// runner: it does NOT drive the scan status lifecycle (start-diagnostic does).
// It exists as a standalone, directly-invocable function for testing and manual
// re-runs; start-diagnostic runs the same engine in the background.
//
// POST { scanRequestId } -> 200 raw_findings (the collected JSON)
//
// All outbound requests go through _shared/safeFetch.ts (SSRF-guarded). The
// engine only performs GET/HEAD to a bounded set of URLs plus DoH lookups.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { runDiagnostic } from "../_shared/diagnostic.ts";

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
    .select("id, normalized_domain")
    .eq("id", scanRequestId)
    .maybeSingle();

  if (scanErr) {
    console.error("run-diagnostic: scan query failed", scanErr);
    return jsonResponse({ error: "Internal error" }, 500);
  }
  if (!scan) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  await supabase
    .from("scan_requests")
    .update({ diagnostic_started_at: new Date().toISOString() })
    .eq("id", scan.id);

  let rawFindings: unknown;
  try {
    rawFindings = await runDiagnostic(scan.normalized_domain);
  } catch (e) {
    console.error("run-diagnostic: engine crashed", e);
    rawFindings = {
      schema_version: 1,
      normalized_domain: scan.normalized_domain,
      engine_error: String((e as Error)?.message ?? e).slice(0, 300),
      errors: [{ section: "engine", reason: "unhandled_exception" }],
    };
  }

  const { error: upErr } = await supabase
    .from("scan_requests")
    .update({
      raw_findings: rawFindings,
      diagnostic_completed_at: new Date().toISOString(),
    })
    .eq("id", scan.id);

  if (upErr) {
    console.error("run-diagnostic: failed to store raw_findings", upErr);
    return jsonResponse({ error: "Internal error" }, 500);
  }

  return jsonResponse(rawFindings, 200);
});
