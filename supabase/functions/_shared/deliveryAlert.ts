// Alert US when a finished report fails to reach the customer.
// ---------------------------------------------------------------------------
// The report email IS the deliverable of this funnel. Until now a failed send
// only produced a console.error, which nobody reads: the scan sat there marked
// 'completed' while the customer waited for an email that never came, and we had
// no idea. This turns that silence into an email to NOTIFY_EMAIL with the scan
// id and the reason, so it can be followed up by hand.
//
// Deliberately best-effort and never thrown: an alert that fails must not affect
// a report that already exists and is downloadable from the site.

import { sendEmail } from "./email.ts";

export type DeliveryStage = "pdf" | "email";

export interface DeliveryFailure {
  stage: DeliveryStage;
  scanRequestId: string;
  domain: string | null;
  customerEmail: string | null;
  reason: string;
}

export async function alertDeliveryFailure(f: DeliveryFailure): Promise<void> {
  const to = Deno.env.get("NOTIFY_EMAIL");
  if (!to) {
    console.error("alertDeliveryFailure: NOTIFY_EMAIL not set; cannot alert");
    return;
  }

  const what = f.stage === "email"
    ? "NO se ha podido enviar el email del informe"
    : "NO se ha podido generar el PDF del informe";

  const subject = `⚠️ Informe sin entregar — ${f.domain ?? "dominio desconocido"}`;
  const site = (Deno.env.get("SITE_URL") || "https://security.turbineh.com")
    .replace(/\/+$/, "");

  const rows: [string, string][] = [
    ["Problema", what],
    ["Dominio", f.domain ?? "—"],
    ["Email cliente", f.customerEmail ?? "—"],
    ["Motivo", f.reason],
    ["scan_request_id", f.scanRequestId],
    ["Informe", `${site}/report/${f.scanRequestId}`],
    ["UTC", new Date().toISOString()],
  ];

  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    "\n\nEl informe SÍ está generado: se puede reenviar llamando a " +
    "send-report-email con este scan_request_id.";

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#12202F">` +
    `<h2 style="margin:0 0 12px;color:#B42318">${esc(subject)}</h2>` +
    `<table style="border-collapse:collapse;font-size:14px">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:3px 12px 3px 0;color:#48607A">${esc(k)}</td>` +
          `<td style="padding:3px 0"><strong>${esc(v)}</strong></td></tr>`,
      )
      .join("") +
    `</table>` +
    `<p style="font-size:13px;color:#48607A">El informe SÍ está generado. Para ` +
    `reintentar la entrega, llama a <code>send-report-email</code> con este ` +
    `<code>scan_request_id</code>.</p></div>`;

  try {
    const res = await sendEmail({ to, subject, html, text });
    if (!res.ok) console.error("alertDeliveryFailure: send failed", res.error);
  } catch (e) {
    console.error("alertDeliveryFailure: threw", e);
  }
}

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
