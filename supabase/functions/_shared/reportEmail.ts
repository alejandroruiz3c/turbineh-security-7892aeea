// Send the buyer their branded report email (link + PDF attachment).
// ---------------------------------------------------------------------------
// Shared by the send-report-email function and the post-report background chain.
// Localized by scan.lang, non-alarmist, safe to call repeatedly (resend).

import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { sendEmail } from "./email.ts";

const BUCKET = "reports";

// deno-lint-ignore no-explicit-any
type Json = any;

function siteBase(): string {
  return (Deno.env.get("SITE_URL") || "https://turbineh.com").replace(/\/+$/, "");
}

function buildContent(domain: string, link: string, lang: "es" | "en") {
  if (lang === "en") {
    return {
      subject: `Your web exposure report for ${domain} is ready`,
      text:
        `Hello,\n\nWe've completed the non-invasive external diagnosis of ${domain}. ` +
        `You can view and download your PDF report here:\n${link}\n\n` +
        `Tip: the most valuable first step is to hand the report to Claude and let it guide you, ` +
        `step by step, through fixing each finding. The report includes a ready-to-paste message to get started.\n\n` +
        `The full report is also attached to this email.\n\n— TurbineH Security`,
      html: wrap(
        "Your report is ready",
        `We've completed the non-invasive external diagnosis of <strong>${domain}</strong>. ` +
          `Your PDF report is ready to view and download.`,
        "View your report",
        link,
        `The most valuable first step is to hand the report to Claude and let it guide you, step by step, ` +
          `through fixing each finding — the report includes a ready-to-paste message to begin. ` +
          `The full PDF is also attached to this email.`,
      ),
    };
  }
  return {
    subject: `Tu informe de exposición web para ${domain} ya está listo`,
    text:
      `Hola,\n\nHemos completado el diagnóstico externo y no invasivo de ${domain}. ` +
      `Puedes ver y descargar tu informe en PDF aquí:\n${link}\n\n` +
      `Consejo: el primer paso más valioso es entregarle el informe a Claude y dejar que te guíe, ` +
      `paso a paso, para resolver cada hallazgo. El informe incluye un mensaje listo para pegar y empezar.\n\n` +
      `El informe completo también va adjunto a este correo.\n\n— TurbineH Security`,
    html: wrap(
      "Tu informe ya está listo",
      `Hemos completado el diagnóstico externo y no invasivo de <strong>${domain}</strong>. ` +
        `Tu informe en PDF está listo para ver y descargar.`,
      "Ver mi informe",
      link,
      `El primer paso más valioso es entregarle el informe a Claude y dejar que te guíe, paso a paso, ` +
        `para resolver cada hallazgo — el informe incluye un mensaje listo para pegar y empezar. ` +
        `El PDF completo también va adjunto a este correo.`,
    ),
  };
}

function wrap(heading: string, lead: string, cta: string, link: string, footerNote: string): string {
  return (
    `<div style="margin:0;padding:0;background:#0F1D2E;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">` +
    `<div style="max-width:560px;margin:0 auto;background:#0F1D2E">` +
    `<div style="padding:28px 32px 8px">` +
    `<span style="font-size:22px;font-weight:700;color:#FFFFFF">Turbine<span style="color:#6FBE44">H</span></span>` +
    `<span style="font-size:11px;color:#A7B6C7;letter-spacing:2px;margin-left:8px">SECURITY</span>` +
    `</div>` +
    `<div style="background:#FFFFFF;margin:12px 16px 16px;border-radius:10px;padding:28px 28px 24px;color:#12202F">` +
    `<h1 style="margin:0 0 12px;font-size:20px;color:#0F1D2E">${heading}</h1>` +
    `<p style="margin:0 0 20px;font-size:14px;line-height:1.6">${lead}</p>` +
    `<a href="${link}" style="display:inline-block;background:#6FBE44;color:#0F1D2E;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px">${cta}</a>` +
    `<p style="margin:22px 0 0;font-size:12.5px;line-height:1.6;color:#48607A">${footerNote}</p>` +
    `</div>` +
    `<div style="padding:0 32px 26px;font-size:11px;color:#A7B6C7">TurbineH Security · External non-invasive diagnosis</div>` +
    `</div></div>`
  );
}

export interface SendReportEmailResult {
  ok: boolean;
  status: number;
  body: Json;
}

// deno-lint-ignore no-explicit-any
export async function sendReportEmail(supabase: any, scanRequestId: string): Promise<SendReportEmailResult> {
  const { data: scan, error: scanErr } = await supabase
    .from("scan_requests")
    .select("id, status, email, lang, normalized_domain")
    .eq("id", scanRequestId)
    .maybeSingle();
  if (scanErr) {
    console.error("sendReportEmail: scan query failed", scanErr);
    return { ok: false, status: 500, body: { error: "Internal error" } };
  }
  if (!scan) return { ok: false, status: 404, body: { error: "Not found" } };
  if (scan.status !== "completed") {
    return { ok: false, status: 409, body: { error: "Report is not ready", status: scan.status } };
  }
  const email = (scan.email ?? "").toString().trim();
  if (!email) {
    return { ok: false, status: 400, body: { error: "No email on file for this scan" } };
  }

  const lang: "es" | "en" = scan.lang === "en" ? "en" : "es";
  const domain = scan.normalized_domain;
  const link = `${siteBase()}/report/${scanRequestId}?lang=${lang}`;
  const content = buildContent(domain, link, lang);

  // Attach the stored PDF if present.
  const attachments = [];
  try {
    const { data: blob } = await supabase.storage.from(BUCKET).download(`${scanRequestId}.pdf`);
    if (blob) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      attachments.push({
        filename: `TurbineH-Diagnostico-${domain}.pdf`,
        content: encodeBase64(buf),
        contentType: "application/pdf",
      });
    }
  } catch (e) {
    // Non-fatal: send the email with the link even if the PDF isn't attachable.
    console.error("sendReportEmail: could not attach PDF", e);
  }

  const result = await sendEmail({
    to: email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    attachments,
  });

  if (!result.ok) {
    console.error("sendReportEmail: send failed", result.error);
    return { ok: false, status: 502, body: { error: "Could not send the report email" } };
  }
  return { ok: true, status: 200, body: { sent: true, to: maskEmail(email), attached: attachments.length > 0 } };
}

function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  const local = email.slice(0, at);
  const masked = local.length <= 2 ? local[0] + "•" : local[0] + "•".repeat(Math.min(3, local.length - 2)) + local[local.length - 1];
  return `${masked}@${email.slice(at + 1)}`;
}
