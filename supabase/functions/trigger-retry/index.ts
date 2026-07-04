// Edge Function: trigger-retry   (verify_jwt default; called via anon key)
// ---------------------------------------------------------------------------
// Covers the user clicking "cancel" on Stripe (which fires NO webhook event).
// The frontend calls this with the scan id from cancel_url (?sid=...). If the
// scan is unpaid and no retry email was sent in the last ~24h, it sends the
// immediate client retry (recovery email #1). Idempotent via claim_recovery_email.
//
// POST { scanRequestId } -> 200 { ok: true }   (always, to never block the UI)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { makeCors } from "../_shared/cors.ts";
import { sendClientRetry } from "../_shared/sendClientRetry.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { clientIp } from "../_shared/request.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare const EdgeRuntime:
  | { waitUntil(promise: Promise<unknown>): void }
  | undefined;

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = makeCors(req);
  const pf = cors.preflight();
  if (pf) return pf;
  if (req.method !== "POST") return cors.json({ ok: true });

  let body: { scanRequestId?: string };
  try {
    body = await req.json();
  } catch {
    return cors.json({ ok: true });
  }
  const scanRequestId = (body.scanRequestId ?? "").toString().trim();
  if (!UUID_RE.test(scanRequestId)) return cors.json({ ok: true });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Rate limit per IP + per scan so this can't be spammed.
  const ip = clientIp(req);
  const ipOk = await checkRateLimit(supabase, ip, "trigger_retry_ip", 20, 3600);
  const scanOk = await checkRateLimit(supabase, scanRequestId, "trigger_retry_scan", 3, 3600);
  if (ipOk && scanOk) {
    // Fire-and-forget; sendClientRetry itself no-ops if paid / too soon.
    const task = sendClientRetry(supabase, scanRequestId);
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(task);
    else task.catch((e) => console.error("trigger-retry: task error", e));
  }

  return cors.json({ ok: true });
});
