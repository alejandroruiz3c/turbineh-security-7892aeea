// AI report generation — turns raw_findings into a valuable, clear, honest,
// bilingual, slide-ready report.
// ---------------------------------------------------------------------------
// Division of labour:
//   * CODE owns the score + per-finding severities (score.ts). The model is
//     given them as fixed facts and only explains them.
//   * The MODEL (claude-fable-5, pinned) writes the narrative in the user's
//     language, grounded ONLY in raw_findings. After every call we verify the
//     response model starts with "claude-fable"; if not, we retry (max 2) and
//     otherwise fail the scan — we never serve a report from the wrong model.
//   * The "start with Claude" action entry point is built deterministically in
//     code (exact mandated framing, domain + tech filled) and overrides whatever
//     the model produced, so the wording is always correct.
//
// Two hard grounding rules are enforced in the prompt and the score inputs:
//   a) TLS: issuer/expiry are null (runtime can't read the cert) — may only say
//      "HTTPS is reachable and the TLS handshake is accepted" (+HSTS/redirect).
//   b) exposed_paths: a 200 is "a path appears reachable, worth confirming",
//      never a confirmed exposure.

import { computeScore, type ScoredFinding, type Severity } from "./score.ts";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-fable-5";
const MAX_ATTEMPTS = 3; // initial + 2 retries
const EFFORT = "medium"; // depth control (thinking is always-on on Fable 5)

// Fable 5 pricing ($/1M tokens): input 10, output 50; cache read 0.1x, write 1.25x.
const PRICE_IN = 10 / 1_000_000;
const PRICE_OUT = 50 / 1_000_000;
const PRICE_CACHE_READ = 1 / 1_000_000;
const PRICE_CACHE_WRITE = 12.5 / 1_000_000;

// deno-lint-ignore no-explicit-any
type Json = any;

// ---------------------------------------------------------------------------
// Structured-output schema (output_config.format). Strict mode: every object
// has additionalProperties:false and lists all its keys in required.
// ---------------------------------------------------------------------------
const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    executive_summary: { type: "string" },
    overall_verdict: { type: "string" },
    top_priorities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { title: { type: "string" }, why_now: { type: "string" } },
        required: ["title", "why_now"],
      },
    },
    start_with_claude: {
      type: "object",
      additionalProperties: false,
      properties: { intro: { type: "string" }, master_prompt: { type: "string" } },
      required: ["intro", "master_prompt"],
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["info", "low", "medium", "high", "critical"] },
          what_we_detected: { type: "string" },
          why_it_matters: { type: "string" },
          business_impact: { type: "string" },
          recommended_action: { type: "string" },
          how_to_fix_with_ai: { type: "string" },
          ai_prompt: { type: "string" },
          when_to_get_technical_help: { type: "string" },
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          time_estimate: { type: "string" },
          priority: { type: "integer" },
        },
        required: [
          "title", "severity", "what_we_detected", "why_it_matters",
          "business_impact", "recommended_action", "how_to_fix_with_ai",
          "ai_prompt", "when_to_get_technical_help", "difficulty",
          "time_estimate", "priority",
        ],
      },
    },
    action_plan: {
      type: "object",
      additionalProperties: false,
      properties: {
        next_24h: { type: "array", items: { type: "string" } },
        next_7d: { type: "array", items: { type: "string" } },
        next_30d: { type: "array", items: { type: "string" } },
      },
      required: ["next_24h", "next_7d", "next_30d"],
    },
    final_checklist: { type: "array", items: { type: "string" } },
    when_to_get_help: { type: "string" },
    disclaimer: { type: "string" },
  },
  required: [
    "executive_summary", "overall_verdict", "top_priorities", "start_with_claude",
    "findings", "action_plan", "final_checklist", "when_to_get_help", "disclaimer",
  ],
};

// ---------------------------------------------------------------------------
// The mandated "Start with Claude" action entry point (deterministic).
// ---------------------------------------------------------------------------
function techLabel(raw: Json, lang: "es" | "en"): string {
  const detected: string[] = Array.isArray(raw?.tech?.detected) ? raw.tech.detected : [];
  const cmsName = raw?.cms?.detected && raw?.cms?.name ? raw.cms.name : null;
  const parts = [...new Set([...(cmsName ? [cmsName] : []), ...detected])];
  if (parts.length > 0) return parts.join(", ");
  return lang === "es"
    ? "tu tecnología web (no detectada con certeza en el análisis externo)"
    : "your website technology (not identified with certainty in the external scan)";
}

function buildStartWithClaude(domain: string, raw: Json, lang: "es" | "en") {
  const tech = techLabel(raw, lang);
  if (lang === "es") {
    return {
      intro:
        "El primer paso es el más importante: entrégale este informe a Claude y deja que sea tu " +
        "director de ejecución. Sube este PDF en claude.ai y pega el mensaje de abajo. A partir de " +
        "ahí, tú ejecutas y Claude te guía gratis, paso a paso y en lenguaje claro, hasta resolver " +
        "todos los hallazgos.",
      master_prompt:
        `Te adjunto el informe de diagnóstico de exposición web de mi dominio ${domain}, de TurbineH ` +
        "Security. Actúa como mi director de ejecución en seguridad web. Guíame paso a paso, por orden " +
        "de prioridad, para resolver cada hallazgo del informe. Antes de cada cambio explícame en " +
        "lenguaje sencillo qué vamos a hacer y por qué, dime si puedo hacerlo yo mismo o necesito ayuda " +
        `técnica, y dame las instrucciones exactas para mi tecnología (${tech}). Empecemos por el ` +
        "hallazgo de mayor prioridad y no avances al siguiente hasta que confirme que el anterior está " +
        "resuelto.",
    };
  }
  return {
    intro:
      "The first step is the most important one: hand this report to Claude and let it act as your " +
      "execution director. Upload this PDF at claude.ai and paste the message below. From there, you " +
      "execute and Claude guides you for free, step by step and in plain language, until every finding " +
      "is resolved.",
    master_prompt:
      `I'm attaching the web exposure diagnostic report for my domain ${domain}, from TurbineH Security. ` +
      "Act as my web-security execution director. Guide me step by step, in priority order, to resolve " +
      "every finding in the report. Before each change, explain in plain language what we're going to do " +
      "and why, tell me whether I can do it myself or need technical help, and give me the exact " +
      `instructions for my technology (${tech}). Let's start with the highest-priority finding and don't ` +
      "move to the next one until I confirm the previous one is resolved.",
  };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------
function buildSystemPrompt(lang: "es" | "en"): string {
  const langName = lang === "es" ? "Spanish (español)" : "English";
  return [
    "You are a calm, clear web-security explainer writing for a NON-TECHNICAL small business owner.",
    `Write ALL output in ${langName}. Use plain, reassuring, non-alarmist language — no fear-mongering.`,
    "You must NEVER include offensive, exploitation, or attack instructions. This is a defensive report.",
    "",
    "GROUNDING RULES (mandatory — breaking these makes the report invalid):",
    "1. Use ONLY the observations provided to you. If a value is null/unknown, say it was \"not assessed in this external scan\" — never invent, infer, or embellish a result.",
    "2. TLS: the scan can confirm ONLY that HTTPS is reachable and the TLS handshake is accepted (plus HSTS and http→https redirect behaviour). You must NEVER state or guess a certificate's expiry, issuer, protocol version, or cipher — that data was not collected.",
    "3. exposed_paths: an HTTP 200 on a path like /wp-admin/ or /.env does NOT confirm an exposed or vulnerable panel — many sites return 200 for every path. Describe it cautiously as \"a login/admin path appears reachable and is worth confirming\", never as a confirmed exposure or breach.",
    "",
    "SCORING: the overall score and each finding's severity are FIXED and computed independently. Keep every severity exactly as given. Do not re-score, upgrade, or downgrade anything.",
    "",
    "For each finding, adapt the recommended fix and the copy-paste AI prompt to the detected CMS/technology when it is known; when tech is unknown, keep the fix general and say so.",
    "Produce exactly one findings[] entry for each finding provided, in the same priority order, preserving its severity.",
    "The report will become a presentation-style PDF, so write in clear, self-contained, slide-ready sentences.",
    "Return ONLY the structured JSON required by the schema.",
  ].join("\n");
}

function buildUserPrompt(
  domain: string,
  lang: "es" | "en",
  raw: Json,
  overallScore: number,
  riskLevel: string,
  findings: ScoredFinding[],
): string {
  const findingsForModel = findings.map((f) => ({
    priority: f.priority,
    severity: f.severity,
    label_en: f.label,
    observed: f.observed,
  }));
  return [
    `DOMAIN: ${domain}`,
    `LANGUAGE: ${lang}`,
    `FIXED overall_score (0-100, computed in code): ${overallScore}`,
    `FIXED risk_level: ${riskLevel}`,
    "",
    "DETECTED TECHNOLOGY (from the scan; may be empty):",
    JSON.stringify({ tech: raw?.tech ?? null, cms: raw?.cms ?? null }),
    "",
    "FINDINGS TO EXPLAIN — produce exactly one findings[] entry per item below, in this order, keeping the given severity and priority. Translate label_en into a clear title in the target language and ground every field in `observed` (and the raw findings below). Set each finding's `priority` to the value shown:",
    JSON.stringify(findingsForModel, null, 2),
    "",
    "FULL RAW FINDINGS (the only facts you may speak to; nulls mean \"not assessed\"):",
    JSON.stringify(raw),
    "",
    "Also write: an executive_summary (4-6 plain sentences), one honest overall_verdict headline, 3-5 top_priorities, a start_with_claude section (intro + master_prompt — this will be replaced by the canonical wording, but produce a good-faith version), an action_plan (next_24h / next_7d / next_30d), a final_checklist, a when_to_get_help note, and a short disclaimer that this was a non-invasive external scan and not a guarantee.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Fable 5 call with model pin + retries
// ---------------------------------------------------------------------------
interface FableResult {
  ok: boolean;
  report?: Json;
  model?: string;
  cost?: number;
  error?: string;
}

function computeCost(usage: Json): number {
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
  return (
    input * PRICE_IN +
    output * PRICE_OUT +
    cacheRead * PRICE_CACHE_READ +
    cacheWrite * PRICE_CACHE_WRITE
  );
}

async function callFable(
  apiKey: string,
  model: string,
  system: string,
  user: string,
): Promise<FableResult> {
  let lastError = "unknown";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(ANTHROPIC_ENDPOINT, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        // NOTE: no `thinking` (always-on on Fable 5), no temperature/top_p (400 on Fable 5).
        body: JSON.stringify({
          model,
          max_tokens: 16000,
          system,
          messages: [{ role: "user", content: user }],
          output_config: {
            effort: EFFORT,
            format: { type: "json_schema", schema: REPORT_SCHEMA },
          },
        }),
      });
    } catch (e) {
      lastError = `network:${String((e as Error)?.message ?? e).slice(0, 120)}`;
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      lastError = `http_${res.status}:${body.slice(0, 200)}`;
      // 401/400 won't fix on retry, but retrying is cheap and bounded.
      continue;
    }

    const data = await res.json().catch(() => null);
    if (!data) {
      lastError = "invalid_json_envelope";
      continue;
    }

    // MODEL PIN: never serve a report produced by a non-Fable model.
    const respModel = (data.model ?? "").toString();
    if (!respModel.startsWith("claude-fable")) {
      lastError = `wrong_model:${respModel}`;
      continue;
    }

    // Safety-classifier refusal → cannot serve.
    if (data.stop_reason === "refusal") {
      lastError = "refusal";
      continue;
    }

    const textBlock = Array.isArray(data.content)
      ? data.content.find((b: Json) => b?.type === "text")
      : null;
    if (!textBlock?.text) {
      lastError = `no_text_block:stop=${data.stop_reason}`;
      continue;
    }

    let report: Json;
    try {
      report = JSON.parse(textBlock.text);
    } catch {
      lastError = "json_parse_failed";
      continue;
    }

    return { ok: true, report, model: respModel, cost: computeCost(data.usage) };
  }
  return { ok: false, error: lastError };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const REQUIRED_SECTIONS = [
  "executive_summary", "overall_verdict", "top_priorities", "start_with_claude",
  "findings", "action_plan", "final_checklist", "when_to_get_help", "disclaimer",
];

function validateReport(report: Json, expectedFindings: number): string | null {
  for (const key of REQUIRED_SECTIONS) {
    if (report[key] === undefined || report[key] === null) return `missing_section:${key}`;
  }
  if (!Array.isArray(report.findings) || report.findings.length === 0) {
    // A clean site can have zero findings — allow empty ONLY when code found none.
    if (expectedFindings !== 0) return "findings_empty";
  }
  if (!report.action_plan?.next_24h || !report.action_plan?.next_7d || !report.action_plan?.next_30d) {
    return "action_plan_incomplete";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry: generate + persist the report for a scan.
// ---------------------------------------------------------------------------
export interface GenerateResult {
  ok: boolean;
  status: number;
  body: Json;
}

// deno-lint-ignore no-explicit-any
export async function generateReport(supabase: any, scanRequestId: string): Promise<GenerateResult> {
  const { data: scan, error: scanErr } = await supabase
    .from("scan_requests")
    .select("id, normalized_domain, lang, status, report_consumed, raw_findings")
    .eq("id", scanRequestId)
    .maybeSingle();

  if (scanErr) {
    console.error("generateReport: scan query failed", scanErr);
    return { ok: false, status: 500, body: { error: "Internal error" } };
  }
  if (!scan) return { ok: false, status: 404, body: { error: "Not found" } };

  // --- Guards --------------------------------------------------------------
  if (!scan.raw_findings) {
    return { ok: false, status: 409, body: { error: "No diagnostic findings to report on" } };
  }
  if (scan.status !== "processing") {
    return { ok: false, status: 409, body: { error: "Scan is not in the processing state", status: scan.status } };
  }
  const { data: existing, error: existErr } = await supabase
    .from("diagnostic_reports")
    .select("id")
    .eq("scan_request_id", scan.id)
    .maybeSingle();
  if (existErr) {
    console.error("generateReport: report lookup failed", existErr);
    return { ok: false, status: 500, body: { error: "Internal error" } };
  }
  if (existing) {
    return { ok: false, status: 409, body: { error: "A report already exists for this scan" } };
  }

  const lang: "es" | "en" = scan.lang === "en" ? "en" : "es";
  const domain = scan.normalized_domain;
  const raw = scan.raw_findings;

  // --- Score (code-owned) --------------------------------------------------
  const score = computeScore(raw);

  const apiKey = Deno.env.get("AI_API_KEY");
  const model = Deno.env.get("AI_MODEL") || DEFAULT_MODEL;
  if (!apiKey) {
    console.error("generateReport: AI_API_KEY not set");
    await failScan(supabase, scan.id);
    return { ok: false, status: 500, body: { error: "AI not configured" } };
  }

  // --- Model call (pinned + retried) ---------------------------------------
  const system = buildSystemPrompt(lang);
  const user = buildUserPrompt(domain, lang, raw, score.overall_score, score.risk_level, score.findings);
  const result = await callFable(apiKey, model, system, user);

  if (!result.ok || !result.report) {
    console.error("generateReport: model call failed", result.error);
    await failScan(supabase, scan.id);
    return { ok: false, status: 502, body: { error: "Report generation failed", reason: result.error } };
  }

  const validationError = validateReport(result.report, score.findings.length);
  if (validationError) {
    console.error("generateReport: invalid report JSON", validationError);
    await failScan(supabase, scan.id);
    return { ok: false, status: 502, body: { error: "Report validation failed", reason: validationError } };
  }

  const report = result.report;

  // --- Enforce code-owned severities + priorities on the findings ----------
  const modelFindings: Json[] = Array.isArray(report.findings) ? report.findings : [];
  const byPriority = [...score.findings].sort((a, b) => a.priority - b.priority);
  const groundedFindings = modelFindings
    .slice()
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    .map((mf, i) => {
      const code = byPriority[i];
      return {
        ...mf,
        severity: (code?.severity ?? mf.severity) as Severity,
        priority: code?.priority ?? mf.priority,
      };
    });

  // --- Canonical "Start with Claude" (overrides the model) -----------------
  const startWithClaude = buildStartWithClaude(domain, raw, lang);

  // --- Persist -------------------------------------------------------------
  const aiPrompts = {
    start_with_claude: startWithClaude,
    overall_verdict: report.overall_verdict,
    top_priorities: report.top_priorities,
    final_checklist: report.final_checklist,
    when_to_get_help: report.when_to_get_help,
    disclaimer: report.disclaimer,
    finding_prompts: groundedFindings.map((f: Json) => ({ title: f.title, ai_prompt: f.ai_prompt })),
  };

  const nowIso = new Date().toISOString();
  const { error: insErr } = await supabase.from("diagnostic_reports").insert({
    scan_request_id: scan.id,
    domain,
    lang,
    overall_score: score.overall_score,
    risk_level: score.risk_level,
    executive_summary: report.executive_summary,
    findings_json: groundedFindings,
    action_plan_json: report.action_plan,
    ai_prompts_json: aiPrompts,
    model_used: result.model,
    ai_cost: result.cost ?? 0,
    completed_at: nowIso,
  });
  if (insErr) {
    console.error("generateReport: insert failed", insErr);
    await failScan(supabase, scan.id);
    return { ok: false, status: 500, body: { error: "Internal error" } };
  }

  const { error: updErr } = await supabase
    .from("scan_requests")
    .update({ status: "completed", report_consumed: true, report_consumed_at: nowIso })
    .eq("id", scan.id);
  if (updErr) {
    console.error("generateReport: status update failed", updErr);
    // The report row exists; surface success but log the status inconsistency.
  }

  return {
    ok: true,
    status: 200,
    body: {
      status: "completed",
      overall_score: score.overall_score,
      risk_level: score.risk_level,
      model_used: result.model,
    },
  };
}

// deno-lint-ignore no-explicit-any
async function failScan(supabase: any, scanId: string): Promise<void> {
  const { error } = await supabase
    .from("scan_requests")
    .update({ status: "failed" })
    .eq("id", scanId);
  if (error) console.error("generateReport: failed to set status=failed", error);
}
