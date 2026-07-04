// Shared email sender built on the Resend HTTP API.
//
// Reads two Edge Function secrets:
//   RESEND_API_KEY  — the Resend API key (server-side only, never exposed).
//   FROM_EMAIL      — the verified sender address (e.g. "alex.ruiz@turbineh.com"
//                     or "Turbine H <alex.ruiz@turbineh.com>").
//
// This helper is intentionally provider-specific but dependency-free so it can
// be reused by any Edge Function (verification codes now, report delivery later).

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  /** Plain-text fallback. Strongly recommended for deliverability. */
  text?: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** Resend message id when the send succeeded. */
  id?: string;
  /** Safe, short error description when it failed (never leak to clients raw). */
  error?: string;
  /** Underlying HTTP status from Resend, when available. */
  status?: number;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Send a single transactional email through Resend.
 *
 * Never throws: always resolves to a SendEmailResult so callers can decide how
 * to react (e.g. surface a friendly message) without try/catch noise. Callers
 * MUST NOT forward `error` verbatim to end users.
 */
export async function sendEmail(
  params: SendEmailParams,
): Promise<SendEmailResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("FROM_EMAIL");

  if (!apiKey) {
    console.error("sendEmail: RESEND_API_KEY is not set");
    return { ok: false, error: "email_not_configured" };
  }
  if (!from) {
    console.error("sendEmail: FROM_EMAIL is not set");
    return { ok: false, error: "email_not_configured" };
  }

  const payload: Record<string, unknown> = {
    from,
    to: [params.to],
    subject: params.subject,
    html: params.html,
  };
  if (params.text) payload.text = params.text;

  let res: Response;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("sendEmail: network error calling Resend", err);
    return { ok: false, error: "email_send_failed" };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Resend normally returns JSON; tolerate an empty/invalid body.
  }

  if (!res.ok) {
    // Log full detail server-side; return only a short, safe marker.
    console.error("sendEmail: Resend returned an error", res.status, body);
    return { ok: false, error: "email_send_failed", status: res.status };
  }

  const id =
    body && typeof body === "object" && "id" in body
      ? String((body as { id?: unknown }).id ?? "")
      : undefined;

  return { ok: true, id, status: res.status };
}
