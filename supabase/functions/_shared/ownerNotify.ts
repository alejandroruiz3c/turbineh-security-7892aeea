// Owner (account holder) notifications for every payment outcome — success AND
// non-success. Sent to STRIPE_NOTIFY_EMAIL from FROM_EMAIL via Resend.

import { sendEmail } from "./email.ts";

export type OwnerEvent = "paid" | "expired" | "failed";

export interface OwnerInfo {
  event: OwnerEvent;
  email: string | null;
  domain: string | null;
  normalizedDomain: string | null;
  amount: number | null; // cents
  currency: string | null;
  lang: string | null;
  scanRequestId: string;
  customerId: string | null;
  status: string | null;
  failureReason?: string | null;
}

function money(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  const cur = (currency ?? "eur").toUpperCase();
  const sym = cur === "EUR" ? "€" : cur === "USD" ? "$" : cur + " ";
  return `${(amount / 100).toFixed(2)}${sym === "€" ? "€" : " " + sym}`.replace("  ", " ").trim();
}

export async function notifyOwner(info: OwnerInfo): Promise<void> {
  const to = Deno.env.get("STRIPE_NOTIFY_EMAIL");
  if (!to) {
    console.error("notifyOwner: STRIPE_NOTIFY_EMAIL not set");
    return;
  }
  const amountStr = money(info.amount, info.currency);
  const ts = new Date().toISOString();

  let subject: string;
  if (info.event === "paid") {
    subject = `TurbineH — Pago completado ${amountStr}`;
  } else if (info.event === "expired") {
    subject = "TurbineH — Pago no completado (abandonado)";
  } else {
    subject = "TurbineH — Pago no completado (fallido)";
  }

  const rows: [string, string | null | undefined][] = [
    ["Evento", info.event],
    ["Email", info.email],
    ["Dominio", info.domain],
    ["Dominio normalizado", info.normalizedDomain],
    ["Importe", amountStr],
    ["Moneda", info.currency],
    ["Lang", info.lang],
    ["scan_request_id", info.scanRequestId],
    ["customer_id", info.customerId],
    ["Estado scan", info.status],
    ["Motivo fallo", info.failureReason ?? undefined],
    ["UTC", ts],
  ];

  const text = rows
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#12202F">` +
    `<h2 style="margin:0 0 12px;color:#0F1D2E">${subject}</h2>` +
    `<table style="border-collapse:collapse;font-size:14px">` +
    rows
      .filter(([, v]) => v !== undefined && v !== null)
      .map(
        ([k, v]) =>
          `<tr><td style="padding:3px 12px 3px 0;color:#48607A">${k}</td>` +
          `<td style="padding:3px 0"><strong>${v}</strong></td></tr>`,
      )
      .join("") +
    `</table></div>`;

  const res = await sendEmail({ to, subject, html, text });
  if (!res.ok) console.error("notifyOwner: send failed", res.error);
}
