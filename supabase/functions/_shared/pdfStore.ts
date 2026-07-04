// Build + store the report PDF and mint a short-lived signed download URL.
// ---------------------------------------------------------------------------
// Shared by the generate-pdf function and by the post-report background chain.
// The "reports" bucket is PRIVATE — access only via service role (here) and via
// the signed URLs this returns.

import { buildReportPdf } from "./reportPdf.ts";

const BUCKET = "reports";
const SIGNED_TTL = 3600; // 1 hour

// deno-lint-ignore no-explicit-any
type Json = any;

/** Reassemble the full localized report object from a diagnostic_reports row. */
export function reassembleReport(row: Json): Json {
  const extra = row.ai_prompts_json ?? {};
  return {
    domain: row.domain,
    overall_score: row.overall_score,
    risk_level: row.risk_level,
    executive_summary: row.executive_summary,
    overall_verdict: extra.overall_verdict ?? null,
    top_priorities: extra.top_priorities ?? [],
    start_with_claude: extra.start_with_claude ?? null,
    findings: row.findings_json ?? [],
    action_plan: row.action_plan_json ?? null,
    final_checklist: extra.final_checklist ?? [],
    when_to_get_help: extra.when_to_get_help ?? null,
    disclaimer: extra.disclaimer ?? null,
  };
}

function safeName(domain: string): string {
  const d = (domain ?? "report").toLowerCase().replace(/[^a-z0-9.-]/g, "-").replace(/-+/g, "-");
  return `TurbineH-Diagnostico-${d}.pdf`;
}

export interface EnsurePdfResult {
  ok: boolean;
  status: number;
  body: Json;
}

// deno-lint-ignore no-explicit-any
export async function ensureReportPdf(
  supabase: any,
  scanRequestId: string,
  opts: { force?: boolean } = {},
): Promise<EnsurePdfResult> {
  const { data: scan, error: scanErr } = await supabase
    .from("scan_requests")
    .select("id, status")
    .eq("id", scanRequestId)
    .maybeSingle();
  if (scanErr) {
    console.error("ensureReportPdf: scan query failed", scanErr);
    return { ok: false, status: 500, body: { error: "Internal error" } };
  }
  if (!scan) return { ok: false, status: 404, body: { error: "Not found" } };
  if (scan.status !== "completed") {
    return { ok: false, status: 409, body: { error: "Report is not ready", status: scan.status } };
  }

  const { data: row, error: repErr } = await supabase
    .from("diagnostic_reports")
    .select("domain, lang, overall_score, risk_level, executive_summary, findings_json, action_plan_json, ai_prompts_json")
    .eq("scan_request_id", scan.id)
    .maybeSingle();
  if (repErr) {
    console.error("ensureReportPdf: report query failed", repErr);
    return { ok: false, status: 500, body: { error: "Internal error" } };
  }
  if (!row) return { ok: false, status: 404, body: { error: "No report to render" } };

  const lang: "es" | "en" = row.lang === "en" ? "en" : "es";
  const path = `${scanRequestId}.pdf`;

  // Does a PDF already exist?
  let exists = false;
  const { data: listing } = await supabase.storage.from(BUCKET).list("", { limit: 100, search: `${scanRequestId}.pdf` });
  if (Array.isArray(listing)) exists = listing.some((f: Json) => f.name === `${scanRequestId}.pdf`);

  let rebuilt = false;
  if (!exists || opts.force) {
    let bytes: Uint8Array;
    try {
      const report = reassembleReport(row);
      bytes = await buildReportPdf(report, lang);
    } catch (e) {
      console.error("ensureReportPdf: PDF build failed", e);
      return { ok: false, status: 500, body: { error: "PDF build failed" } };
    }
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) {
      console.error("ensureReportPdf: upload failed", upErr);
      return { ok: false, status: 500, body: { error: "Upload failed" } };
    }
    rebuilt = true;
    await supabase.from("diagnostic_reports").update({ pdf_url: `${BUCKET}/${path}` }).eq("scan_request_id", scan.id);
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_TTL, { download: safeName(row.domain) });
  if (signErr || !signed?.signedUrl) {
    console.error("ensureReportPdf: sign failed", signErr);
    return { ok: false, status: 500, body: { error: "Could not create download link" } };
  }

  return {
    ok: true,
    status: 200,
    body: {
      signedUrl: signed.signedUrl,
      path: `${BUCKET}/${path}`,
      filename: safeName(row.domain),
      rebuilt,
      expiresInSeconds: SIGNED_TTL,
    },
  };
}
