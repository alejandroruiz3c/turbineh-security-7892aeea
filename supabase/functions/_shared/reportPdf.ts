// Branded, presentation-style PDF built ENTIRELY IN CODE with pdf-lib.
// ---------------------------------------------------------------------------
// No external service, no account, no network calls for rendering. Landscape
// 16:9 slides, one section per page, built-in fonts only (Helvetica / -Bold /
// Courier). buildReportPdf(report, lang) -> Uint8Array.
//
// `report` is the reassembled localized report:
//   { domain, overall_score, risk_level, executive_summary, overall_verdict,
//     top_priorities:[{title,why_now}], start_with_claude:{intro,master_prompt},
//     findings:[{title,severity,what_we_detected,why_it_matters,business_impact,
//                recommended_action,how_to_fix_with_ai,ai_prompt,
//                when_to_get_technical_help,difficulty,time_estimate,priority}],
//     action_plan:{next_24h,next_7d,next_30d}, final_checklist:[],
//     when_to_get_help, disclaimer }

import {
  PDFDocument,
  type PDFImage,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "https://esm.sh/pdf-lib@1.17.1";
import { LOGO_PNG_BASE64 } from "./logo.ts";

import type { Report, ReportFinding } from "./reportTypes.ts";
type Lang = "es" | "en";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// ---- Brand palette -------------------------------------------------------
function hex(h: string): RGB {
  const s = h.replace("#", "");
  return rgb(
    parseInt(s.slice(0, 2), 16) / 255,
    parseInt(s.slice(2, 4), 16) / 255,
    parseInt(s.slice(4, 6), 16) / 255,
  );
}
const C = {
  navy: hex("#0F1D2E"),
  navy2: hex("#16283C"),
  green: hex("#6FBE44"),
  greenDark: hex("#3E9A34"),
  white: hex("#FFFFFF"),
  muted: hex("#A7B6C7"),
  surface: hex("#FFFFFF"),
  textDark: hex("#12202F"),
  panel: hex("#F2F5F8"),
  panelLine: hex("#DCE4EC"),
};
const SEV = {
  critical: hex("#E5484D"),
  high: hex("#F76B15"),
  medium: hex("#F5A623"),
  low: hex("#6FBE44"),
  info: hex("#6FBE44"),
};

// ---- Page geometry -------------------------------------------------------
const W = 960;
const H = 540;
const M = 54;
const CW = W - 2 * M; // content width

// ---- Localized labels ----------------------------------------------------
const T = {
  es: {
    cover_title: "Diagnóstico de exposición web",
    prepared: "Informe preparado para",
    exec: "Resumen ejecutivo",
    score_of: "de 100",
    risk: {
      low: "Riesgo bajo",
      moderate: "Riesgo moderado",
      high: "Riesgo alto",
      critical: "Riesgo crítico",
    },
    start_title: "EMPIEZA AQUÍ: RESUÉLVELO CON CLAUDE",
    step1: "Paso 1",
    priorities: "Prioridades principales",
    f_detected: "Qué detectamos",
    f_why: "Por qué importa",
    f_impact: "Impacto para el negocio",
    f_action: "Acción recomendada",
    f_ai: "Cómo resolverlo con Claude",
    f_prompt: "Mensaje para pegar en Claude",
    f_help: "Cuándo pedir ayuda técnica",
    f_priority: "Prioridad",
    f_difficulty: "Dificultad",
    f_time: "Tiempo",
    difficulty: { easy: "Fácil", medium: "Media", hard: "Difícil" },
    finding_of: (i: number, n: number) => `Hallazgo ${i} de ${n}`,
    cont: "(continuación)",
    plan: "Plan de acción",
    plan_24h: "Primeras 24 horas",
    plan_7d: "Próximos 7 días",
    plan_30d: "Próximos 30 días",
    checklist: "Lista de verificación final",
    help: "Cuándo pedir ayuda técnica",
    disclaimer: "Aviso importante",
    footer: "TurbineH Security · Diagnóstico externo no invasivo",
    no_findings: "No se detectaron hallazgos accionables en este análisis externo.",
  },
  en: {
    cover_title: "Web Exposure Diagnosis",
    prepared: "Report prepared for",
    exec: "Executive summary",
    score_of: "of 100",
    risk: {
      low: "Low risk",
      moderate: "Moderate risk",
      high: "High risk",
      critical: "Critical risk",
    },
    start_title: "START HERE: FIX IT WITH CLAUDE",
    step1: "Step 1",
    priorities: "Top priorities",
    f_detected: "What we detected",
    f_why: "Why it matters",
    f_impact: "Business impact",
    f_action: "Recommended action",
    f_ai: "How to fix it with Claude",
    f_prompt: "Prompt to paste into Claude",
    f_help: "When to get technical help",
    f_priority: "Priority",
    f_difficulty: "Difficulty",
    f_time: "Time",
    difficulty: { easy: "Easy", medium: "Medium", hard: "Hard" },
    finding_of: (i: number, n: number) => `Finding ${i} of ${n}`,
    cont: "(continued)",
    plan: "Action plan",
    plan_24h: "Next 24 hours",
    plan_7d: "Next 7 days",
    plan_30d: "Next 30 days",
    checklist: "Final checklist",
    help: "When to get technical help",
    disclaimer: "Important notice",
    footer: "TurbineH Security · External non-invasive diagnosis",
    no_findings: "No actionable findings were detected in this external scan.",
  },
};

function riskColor(band: string): RGB {
  if (band === "critical") return SEV.critical;
  if (band === "high") return SEV.high;
  if (band === "moderate") return SEV.medium;
  return SEV.low;
}
function sevColor(sev: string): RGB {
  return (SEV as Record<string, RGB>)[sev] ?? SEV.medium;
}

// ---------------------------------------------------------------------------
// Text sanitization — the built-in fonts use WinAnsi encoding, which cannot
// encode characters like "→", smart quotes, or emoji (pdf-lib throws). We map
// the common typographic Unicode to ASCII and strip anything still outside
// Latin-1 so the build never fails on model-written text.
// ---------------------------------------------------------------------------
function san(v: unknown): string {
  let t = String(v ?? "");
  t = t
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u00B7\u25CF\u25AA\u2043]/g, "-")
    .replace(/[\u00A0\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g, " ")
    .replace(/[\u2190-\u21FF]/g, "->")
    .replace(/\u2265/g, ">=")
    .replace(/\u2264/g, "<=")
    .replace(/\u00D7/g, "x")
    .replace(/[\u2713\u2714]/g, "")
    // PDF standard fonts only encode Latin-1; filter code points explicitly.
    .split("")
    .filter((character) => character.charCodeAt(0) <= 255)
    .join("");
  return t;
}

function deepSanitize<T>(value: T): T {
  if (typeof value === "string") return san(value) as T;
  if (Array.isArray(value)) return value.map(deepSanitize) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepSanitize(item)]),
    ) as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Text engine
// ---------------------------------------------------------------------------
function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = String(text ?? "")
    .replace(/\r/g, "")
    .split(/\n/);
  const out: string[] = [];
  for (const paragraph of words) {
    const tokens = paragraph.split(/\s+/).filter((w) => w.length > 0);
    if (tokens.length === 0) {
      out.push("");
      continue;
    }
    let cur = "";
    for (const w of tokens) {
      const test = cur ? cur + " " + w : w;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) {
        cur = test;
      } else {
        if (cur) out.push(cur);
        if (font.widthOfTextAtSize(w, size) > maxWidth) {
          // Hard-break an over-long token (URLs, long prompts).
          let chunk = "";
          for (const ch of w) {
            if (font.widthOfTextAtSize(chunk + ch, size) <= maxWidth) chunk += ch;
            else {
              if (chunk) out.push(chunk);
              chunk = ch;
            }
          }
          cur = chunk;
        } else {
          cur = w;
        }
      }
    }
    if (cur) out.push(cur);
  }
  return out.length ? out : [""];
}

interface Ctx {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  courier: PDFFont;
  L: (typeof T)[Lang];
  domain: string;
}
interface Flow {
  page: PDFPage;
  y: number; // cursor: top of the next line to draw
}

function centerText(
  page: PDFPage,
  s: string,
  cx: number,
  y: number,
  size: number,
  font: PDFFont,
  color: RGB,
) {
  const w = font.widthOfTextAtSize(s, size);
  page.drawText(s, { x: cx - w / 2, y, size, font, color });
}

// A content page: navy header strip + title, subtle footer. Returns a Flow.
function contentPage(ctx: Ctx, title: string, sub?: string): Flow {
  const page = ctx.doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.surface });
  // header strip
  page.drawRectangle({ x: 0, y: H - 74, width: W, height: 74, color: C.navy });
  page.drawRectangle({ x: 0, y: H - 78, width: W, height: 4, color: C.green });
  page.drawText(title, { x: M, y: H - 50, size: 21, font: ctx.bold, color: C.white });
  if (sub) {
    const w = ctx.font.widthOfTextAtSize(sub, 11);
    page.drawText(sub, { x: W - M - w, y: H - 46, size: 11, font: ctx.font, color: C.muted });
  }
  // footer
  page.drawText(ctx.L.footer, { x: M, y: 22, size: 8, font: ctx.font, color: C.muted });
  const dw = ctx.font.widthOfTextAtSize(ctx.domain, 8);
  page.drawText(ctx.domain, { x: W - M - dw, y: 22, size: 8, font: ctx.font, color: C.muted });
  return { page, y: H - 74 - 30 };
}

const BOTTOM = 44; // reserve space above footer

// Ensure `needed` vertical space; otherwise start a continuation page.
function ensure(ctx: Ctx, flow: Flow, needed: number, title: string): void {
  if (flow.y - needed >= BOTTOM) return;
  const nf = contentPage(ctx, title, ctx.L.cont);
  flow.page = nf.page;
  flow.y = nf.y;
}

// Draw a paragraph, advancing the cursor. Returns nothing (mutates flow).
function para(
  flow: Flow,
  text: string,
  x: number,
  font: PDFFont,
  size: number,
  color: RGB,
  maxWidth: number,
  gap = 4,
): void {
  const lh = size * 1.34;
  for (const line of wrapLines(text, font, size, maxWidth)) {
    flow.y -= lh;
    flow.page.drawText(line, { x, y: flow.y, size, font, color });
  }
  flow.y -= gap;
}

// Labelled field with pagination (label in green bold, body wrapped).
function field(ctx: Ctx, flow: Flow, label: string, body: string, contTitle: string): void {
  const labelSize = 11;
  const bodySize = 11;
  const lines = wrapLines(body, ctx.font, bodySize, CW);
  const needed = labelSize * 1.4 + lines.length * bodySize * 1.34 + 10;
  ensure(ctx, flow, Math.min(needed, 160), contTitle);
  flow.y -= labelSize * 1.4;
  flow.page.drawText(label, {
    x: M,
    y: flow.y,
    size: labelSize,
    font: ctx.bold,
    color: C.greenDark,
  });
  flow.y -= 2;
  para(flow, body, M, ctx.font, bodySize, C.textDark, CW, 8);
}

// Monospace box (prompt) on a light panel, with pagination.
function courierBox(ctx: Ctx, flow: Flow, text: string, contTitle: string): void {
  const size = 9;
  const pad = 12;
  const lines = wrapLines(text, ctx.courier, size, CW - 2 * pad);
  const lh = size * 1.45;
  const boxH = lines.length * lh + 2 * pad;
  ensure(ctx, flow, boxH + 8, contTitle);
  const top = flow.y;
  const bottom = top - boxH;
  flow.page.drawRectangle({
    x: M,
    y: bottom,
    width: CW,
    height: boxH,
    color: C.panel,
    borderColor: C.panelLine,
    borderWidth: 1,
  });
  flow.page.drawRectangle({ x: M, y: bottom, width: 4, height: boxH, color: C.green });
  let ly = top - pad - size;
  for (const line of lines) {
    flow.page.drawText(line, { x: M + pad, y: ly, size, font: ctx.courier, color: C.textDark });
    ly -= lh;
  }
  flow.y = bottom - 10;
}

// Small rounded-ish chip (label: value).
function chip(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  x: number,
  y: number,
  label: string,
  value: string,
): number {
  const size = 9;
  const txt = `${label}: ${value}`;
  const w = bold.widthOfTextAtSize(txt, size) + 16;
  page.drawRectangle({
    x,
    y: y - 4,
    width: w,
    height: 18,
    color: C.panel,
    borderColor: C.panelLine,
    borderWidth: 1,
  });
  page.drawText(txt, { x: x + 8, y: y + 1, size, font: bold, color: C.textDark });
  return x + w + 8;
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------
function wordmark(page: PDFPage, font: PDFFont, bold: PDFFont, x: number, y: number, scale = 1) {
  // Typographic fallback: "Turbine" white + "H" green + "Security" muted.
  const big = 30 * scale;
  const t = "Turbine";
  page.drawText(t, { x, y, size: big, font: bold, color: C.white });
  const tw = bold.widthOfTextAtSize(t, big);
  page.drawText("H", { x: x + tw, y, size: big, font: bold, color: C.green });
  const hw = bold.widthOfTextAtSize("H", big);
  page.drawText("SECURITY", {
    x: x + 2,
    y: y - 16 * scale,
    size: 11 * scale,
    font,
    color: C.muted,
  });
  return x + tw + hw;
}

function coverSlide(ctx: Ctx, report: Report, lang: Lang, logo: PDFImage | null) {
  const page = ctx.doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.navy });
  page.drawRectangle({ x: 0, y: 0, width: W, height: 8, color: C.green });
  // Real logo (its navy background matches the cover) with wordmark fallback.
  if (logo) {
    const lw = 300;
    const lh = lw * (logo.height / logo.width);
    page.drawImage(logo, { x: M - 6, y: H - 56 - lh, width: lw, height: lh });
  } else {
    wordmark(page, ctx.font, ctx.bold, M, H - 84, 1);
  }
  // title block, vertically centered-ish
  page.drawText(ctx.L.cover_title, { x: M, y: 250, size: 40, font: ctx.bold, color: C.white });
  page.drawText(report.domain ?? "", { x: M, y: 196, size: 30, font: ctx.bold, color: C.green });
  const date = new Date().toISOString().slice(0, 10);
  page.drawText(date, { x: M, y: 150, size: 13, font: ctx.font, color: C.muted });
  // subtle bottom-right mark
  const f = ctx.L.footer;
  const fw = ctx.font.widthOfTextAtSize(f, 9);
  page.drawText(f, { x: W - M - fw, y: 24, size: 9, font: ctx.font, color: C.muted });
}

function scoreSlide(ctx: Ctx, report: Report, lang: Lang) {
  const flow = contentPage(ctx, ctx.L.exec);
  const band = report.risk_level ?? "moderate";
  const col = riskColor(band);
  // Score disc (left)
  const cx = M + 90;
  const cy = flow.y - 60;
  flow.page.drawEllipse({ x: cx, y: cy, xScale: 62, yScale: 62, color: col });
  flow.page.drawEllipse({ x: cx, y: cy, xScale: 52, yScale: 52, color: C.surface });
  const scoreStr = String(report.overall_score ?? "-");
  centerText(flow.page, scoreStr, cx, cy - 6, 44, ctx.bold, C.textDark);
  centerText(flow.page, ctx.L.score_of, cx, cy - 34, 10, ctx.font, C.muted);
  // Risk label
  flow.page.drawText((ctx.L.risk as Record<string, string>)[band] ?? band, {
    x: cx + 100,
    y: cy + 34,
    size: 20,
    font: ctx.bold,
    color: col,
  });
  // Score bar 0-100
  const barX = cx + 100;
  const barY = cy + 6;
  const barW = 420;
  flow.page.drawRectangle({
    x: barX,
    y: barY,
    width: barW,
    height: 12,
    color: C.panel,
    borderColor: C.panelLine,
    borderWidth: 1,
  });
  const pct = Math.max(0, Math.min(100, Number(report.overall_score ?? 0))) / 100;
  flow.page.drawRectangle({ x: barX, y: barY, width: barW * pct, height: 12, color: col });
  // marker
  const mx = barX + barW * pct;
  flow.page.drawRectangle({ x: mx - 1.5, y: barY - 4, width: 3, height: 20, color: C.navy });
  flow.page.drawText("0", { x: barX, y: barY - 16, size: 8, font: ctx.font, color: C.muted });
  flow.page.drawText("100", {
    x: barX + barW - 14,
    y: barY - 16,
    size: 8,
    font: ctx.font,
    color: C.muted,
  });
  // Verdict
  flow.y = cy - 92;
  if (report.overall_verdict) {
    para(flow, report.overall_verdict, M, ctx.bold, 14, C.navy, CW, 10);
  }
  // Executive summary
  para(flow, report.executive_summary ?? "", M, ctx.font, 11.5, C.textDark, CW, 6);
}

function startWithClaudeSlide(ctx: Ctx, report: Report, lang: Lang) {
  const flow = contentPage(ctx, ctx.L.start_title);
  const swc = report.start_with_claude ?? {};
  // Step 1 badge
  flow.y -= 22;
  flow.page.drawRectangle({ x: M, y: flow.y - 4, width: 74, height: 22, color: C.green });
  flow.page.drawText(ctx.L.step1, {
    x: M + 12,
    y: flow.y + 1,
    size: 12,
    font: ctx.bold,
    color: C.white,
  });
  flow.y -= 16;
  para(flow, swc.intro ?? "", M, ctx.font, 12, C.textDark, CW, 12);
  courierBox(ctx, flow, swc.master_prompt ?? "", ctx.L.start_title);
}

function prioritiesSlide(ctx: Ctx, report: Report, lang: Lang) {
  const flow = contentPage(ctx, ctx.L.priorities);
  const items = Array.isArray(report.top_priorities) ? report.top_priorities : [];
  flow.y -= 8;
  items.forEach((p, i) => {
    const titleLines = wrapLines(p.title ?? "", ctx.bold, 13, CW - 44);
    const whyLines = wrapLines(p.why_now ?? "", ctx.font, 10.5, CW - 44);
    const cardH = 18 + titleLines.length * 13 * 1.3 + whyLines.length * 10.5 * 1.34 + 16;
    ensure(ctx, flow, cardH + 8, ctx.L.priorities);
    const top = flow.y;
    const bottom = top - cardH;
    flow.page.drawRectangle({
      x: M,
      y: bottom,
      width: CW,
      height: cardH,
      color: C.panel,
      borderColor: C.panelLine,
      borderWidth: 1,
    });
    // number disc
    flow.page.drawEllipse({ x: M + 22, y: top - 20, xScale: 13, yScale: 13, color: C.navy });
    centerText(flow.page, String(i + 1), M + 22, top - 24, 12, ctx.bold, C.white);
    // title + why
    let ty = top - 16;
    for (const line of titleLines) {
      ty -= 13 * 1.3;
      flow.page.drawText(line, { x: M + 44, y: ty, size: 13, font: ctx.bold, color: C.navy });
    }
    for (const line of whyLines) {
      ty -= 10.5 * 1.34;
      flow.page.drawText(line, { x: M + 44, y: ty, size: 10.5, font: ctx.font, color: C.textDark });
    }
    flow.y = bottom - 10;
  });
  if (items.length === 0) para(flow, ctx.L.no_findings, M, ctx.font, 12, C.muted, CW);
}

function severityBadge(page: PDFPage, bold: PDFFont, x: number, y: number, sev: string) {
  const col = sevColor(sev);
  const label = sev.toUpperCase();
  const w = bold.widthOfTextAtSize(label, 9) + 16;
  page.drawRectangle({ x, y: y - 3, width: w, height: 18, color: col });
  page.drawText(label, { x: x + 8, y: y + 1, size: 9, font: bold, color: C.white });
  return w;
}

function findingSlide(ctx: Ctx, f: ReportFinding, idx: number, total: number, lang: Lang) {
  const contTitle = f.title ?? ctx.L.finding_of(idx, total);
  const flow = contentPage(
    ctx,
    contTitle.length > 70 ? contTitle.slice(0, 67) + "…" : contTitle,
    ctx.L.finding_of(idx, total),
  );
  flow.y -= 16;
  // severity badge + chips row
  const badgeW = severityBadge(flow.page, ctx.bold, M, flow.y, f.severity ?? "medium");
  let chipX = M + badgeW + 10;
  const diff =
    (ctx.L.difficulty as Record<string, string>)[f.difficulty ?? ""] ?? f.difficulty ?? "-";
  chipX = chip(flow.page, ctx.font, ctx.bold, chipX, flow.y, ctx.L.f_difficulty, String(diff));
  chipX = chip(
    flow.page,
    ctx.font,
    ctx.bold,
    chipX,
    flow.y,
    ctx.L.f_time,
    String(f.time_estimate ?? "-"),
  );
  chip(flow.page, ctx.font, ctx.bold, chipX, flow.y, ctx.L.f_priority, String(f.priority ?? "-"));
  flow.y -= 22;

  field(ctx, flow, ctx.L.f_detected, f.what_we_detected ?? "", contTitle);
  field(ctx, flow, ctx.L.f_why, f.why_it_matters ?? "", contTitle);
  field(ctx, flow, ctx.L.f_impact, f.business_impact ?? "", contTitle);
  field(ctx, flow, ctx.L.f_action, f.recommended_action ?? "", contTitle);
  field(ctx, flow, ctx.L.f_ai, f.how_to_fix_with_ai ?? "", contTitle);
  // AI prompt box
  ensure(ctx, flow, 30, contTitle);
  flow.y -= 15;
  flow.page.drawText(ctx.L.f_prompt, {
    x: M,
    y: flow.y,
    size: 11,
    font: ctx.bold,
    color: C.greenDark,
  });
  flow.y -= 4;
  courierBox(ctx, flow, f.ai_prompt ?? "", contTitle);
  field(ctx, flow, ctx.L.f_help, f.when_to_get_technical_help ?? "", contTitle);
}

function columnsSlide(ctx: Ctx, report: Report, lang: Lang) {
  const flow = contentPage(ctx, ctx.L.plan);
  const plan = report.action_plan ?? {};
  const cols = [
    { title: ctx.L.plan_24h, items: plan.next_24h ?? [] },
    { title: ctx.L.plan_7d, items: plan.next_7d ?? [] },
    { title: ctx.L.plan_30d, items: plan.next_30d ?? [] },
  ];
  const gap = 20;
  const colW = (CW - 2 * gap) / 3;
  const top = flow.y - 14;
  cols.forEach((c, i) => {
    const x = M + i * (colW + gap);
    flow.page.drawRectangle({ x, y: top - 26, width: colW, height: 26, color: C.navy });
    flow.page.drawText(c.title, {
      x: x + 10,
      y: top - 18,
      size: 12,
      font: ctx.bold,
      color: C.white,
    });
    let y = top - 26;
    (c.items as string[]).forEach((it) => {
      const lines = wrapLines("•  " + it, ctx.font, 10, colW - 16);
      for (const line of lines) {
        y -= 10 * 1.4;
        flow.page.drawText(line, { x: x + 8, y, size: 10, font: ctx.font, color: C.textDark });
      }
      y -= 4;
    });
  });
}

function listSlide(ctx: Ctx, title: string, items: string[], lang: Lang) {
  const flow = contentPage(ctx, title);
  flow.y -= 8;
  for (const it of items) {
    const lines = wrapLines(it, ctx.font, 12, CW - 24);
    const needed = lines.length * 12 * 1.4 + 8;
    ensure(ctx, flow, needed, title);
    // checkbox
    flow.y -= 12 * 1.4;
    flow.page.drawRectangle({
      x: M,
      y: flow.y - 2,
      width: 11,
      height: 11,
      borderColor: C.greenDark,
      borderWidth: 1.4,
      color: C.surface,
    });
    flow.page.drawText(lines[0], {
      x: M + 22,
      y: flow.y,
      size: 12,
      font: ctx.font,
      color: C.textDark,
    });
    for (let i = 1; i < lines.length; i++) {
      flow.y -= 12 * 1.4;
      flow.page.drawText(lines[i], {
        x: M + 22,
        y: flow.y,
        size: 12,
        font: ctx.font,
        color: C.textDark,
      });
    }
    flow.y -= 6;
  }
}

function textSlide(ctx: Ctx, title: string, body: string, lang: Lang) {
  const flow = contentPage(ctx, title);
  flow.y -= 14;
  para(flow, body, M, ctx.font, 12.5, C.textDark, CW, 6);
}

function disclaimerSlide(ctx: Ctx, report: Report, lang: Lang) {
  const flow = contentPage(ctx, ctx.L.disclaimer);
  flow.y -= 14;
  para(flow, report.disclaimer ?? "", M, ctx.font, 11.5, C.textDark, CW, 6);
  // navy TurbineH footer band
  flow.page.drawRectangle({ x: 0, y: 0, width: W, height: 54, color: C.navy });
  flow.page.drawRectangle({ x: 0, y: 54, width: W, height: 3, color: C.green });
  wordmark(flow.page, ctx.font, ctx.bold, M, 18, 0.7);
  const dm = report.domain ?? "";
  const dmw = ctx.font.widthOfTextAtSize(dm, 11);
  flow.page.drawText(dm, { x: W - M - dmw, y: 22, size: 11, font: ctx.font, color: C.muted });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export async function buildReportPdf(rawReport: Report, lang: Lang): Promise<Uint8Array> {
  // Sanitize all strings up front so no WinAnsi-unencodable char can crash a draw.
  const report: Report = deepSanitize(rawReport);
  const doc = await PDFDocument.create();
  doc.setTitle(`TurbineH Security — ${report.domain ?? ""}`);
  doc.setProducer("TurbineH Security");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const courier = await doc.embedFont(StandardFonts.Courier);
  const ctx: Ctx = { doc, font, bold, courier, L: T[lang], domain: report.domain ?? "" };

  let logo: PDFImage | null = null;
  try {
    logo = await doc.embedPng(b64ToBytes(LOGO_PNG_BASE64));
  } catch (_e) {
    logo = null; // fall back to the typographic wordmark
  }

  coverSlide(ctx, report, lang, logo);
  scoreSlide(ctx, report, lang);
  startWithClaudeSlide(ctx, report, lang);
  prioritiesSlide(ctx, report, lang);

  const findings = Array.isArray(report.findings) ? report.findings : [];
  findings.forEach((f, i) => findingSlide(ctx, f, i + 1, findings.length, lang));

  columnsSlide(ctx, report, lang);
  listSlide(
    ctx,
    ctx.L.checklist,
    Array.isArray(report.final_checklist) ? report.final_checklist : [],
    lang,
  );
  textSlide(ctx, ctx.L.help, report.when_to_get_help ?? "", lang);
  disclaimerSlide(ctx, report, lang);

  return await doc.save();
}
