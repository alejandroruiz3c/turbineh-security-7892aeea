// Edge Function: generate-pdf
// ---------------------------------------------------------------------------
// Builds the branded report PDF entirely in code (pdf-lib, no external service),
// stores it in the private "reports" bucket at reports/{scanRequestId}.pdf, and
// returns a short-lived signed download URL.
//
// POST { scanRequestId, force? }
// Guards (in pdfStore.ensureReportPdf): status='completed' + report row exists.
// Idempotent: skips rebuild when the PDF already exists unless force=true.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { ensureReportPdf } from "../_shared/pdfStore.ts";

interface Body {
  scanRequestId?: string;
  force?: boolean;
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

  const result = await ensureReportPdf(supabase, scanRequestId, { force: body.force === true });
  return jsonResponse(result.body, result.status);
});
