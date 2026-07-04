// Edge Function: generate-ai-report
// ---------------------------------------------------------------------------
// Turns a scan's raw_findings into the AI-written report and stores it. Runs
// the same _shared/report.ts logic that the diagnostic background flow chains
// into; exposed standalone for testing and manual retries.
//
// POST { scanRequestId }
// Guards (in report.ts): raw_findings present, status='processing', no existing
// diagnostic_reports row. Model is pinned to claude-fable-5 (verified per call).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { makeCors } from "../_shared/cors.ts";
import { generateReport } from "../_shared/report.ts";

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

  const result = await generateReport(supabase, scanRequestId);
  return cors.json(result.body, result.status);
});
