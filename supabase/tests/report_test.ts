import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { buildReportPdf } from "../functions/_shared/reportPdf.ts";
import { computeScore } from "../functions/_shared/score.ts";

Deno.test("low-risk bilingual reports render as readable multipage PDFs", async () => {
  for (const lang of ["es", "en"] as const) {
    const bytes = await buildReportPdf(
      {
        domain: "example.com",
        overall_score: 100,
        risk_level: "low",
        executive_summary: "Synthetic report — diagnóstico ficticio ✓",
        findings: [],
        top_priorities: [],
        final_checklist: [],
        action_plan: { next_24h: [], next_7d: [], next_30d: [] },
        disclaimer: "Test fixture, not a security assessment.",
      },
      lang,
    );
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() < 5) throw new Error("Incomplete report");
    if (!doc.getTitle()?.includes("example.com")) throw new Error("Missing report identity");
  }
});

Deno.test("minor header gaps do not classify a healthy baseline as critical", () => {
  const headers = Object.fromEntries(
    [
      "hsts",
      "content_security_policy",
      "x_frame_options",
      "x_content_type_options",
      "referrer_policy",
    ].map((k) => [k, { present: true }]),
  );
  const base = {
    https: { reachable: true },
    headers,
    email: { dmarc: { present: true, policy: "reject" }, spf: { present: true } },
    cookies: [],
    exposed_paths: [],
  };
  if (computeScore(base).overall_score !== 100) throw new Error("Baseline must score 100");
  const reduced = computeScore({
    ...base,
    headers: { ...headers, content_security_policy: { present: false } },
  });
  if (reduced.risk_level !== "low" || reduced.overall_score !== 96)
    throw new Error("Minor gap over-penalized");
});
