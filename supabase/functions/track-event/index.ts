// Edge Function: track-event
// ---------------------------------------------------------------------------
// Privacy-friendly product analytics. Stores an allowlisted event with a HASHED
// IP (never the raw IP). analytics_events is RLS deny-all; only this function
// (service role) writes it. Rate-limited per IP (generous).
//
// POST { event_type, scanRequestId?, lang?, meta? } -> 200 { ok: true }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { makeCors } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { clientIp, hashIp } from "../_shared/request.ts";

interface Body {
  event_type?: string;
  scanRequestId?: string;
  lang?: string;
  meta?: Record<string, unknown>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Allowlist of event types the frontend may send.
const ALLOWED_EVENTS = new Set([
  "landing_view",
  "preview_started",
  "preview_completed",
  "preview_view",
  "checkout_click",
  "unlock_success",
  "verify_view",
  "verify_code_sent",
  "verify_submitted",
  "verify_success",
  "verify_failed",
  "processing_view",
  "report_ready",
  "report_view",
  "pdf_download",
  "email_resend",
  "cta_click",
  "error",
]);

const MAX_META_BYTES = 4096;

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

  const eventType = (body.event_type ?? "").toString().trim();
  if (!ALLOWED_EVENTS.has(eventType)) {
    // Silently accept-but-ignore unknown types so a stale frontend never errors.
    return cors.json({ ok: true, ignored: true }, 200);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Generous per-IP rate limit — analytics should not be throttled into gaps,
  // but this stops a flood from filling the table.
  const ip = clientIp(req);
  const ipHash = await hashIp(ip);
  const ok = await checkRateLimit(supabase, ip, "track_event", 300, 3600);
  if (!ok) {
    // Don't 429 analytics loudly — just drop it.
    return cors.json({ ok: true, dropped: true }, 200);
  }

  const scanRequestId =
    body.scanRequestId && UUID_RE.test(body.scanRequestId.toString())
      ? body.scanRequestId.toString()
      : null;
  const lang = body.lang === "en" ? "en" : body.lang === "es" ? "es" : null;

  let meta: Record<string, unknown> | null = null;
  if (body.meta && typeof body.meta === "object") {
    try {
      const s = JSON.stringify(body.meta);
      if (s.length <= MAX_META_BYTES) meta = body.meta;
    } catch {
      meta = null;
    }
  }

  const { error } = await supabase.from("analytics_events").insert({
    event_type: eventType,
    scan_request_id: scanRequestId,
    lang,
    meta,
    ip_hash: ipHash,
  });
  if (error) {
    // Never fail the caller over analytics.
    console.error("track-event: insert failed", error);
    return cors.json({ ok: true, stored: false }, 200);
  }

  return cors.json({ ok: true }, 200);
});
