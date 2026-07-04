// Edge Function: stripe-webhook   (deploy with --no-verify-jwt)
// ---------------------------------------------------------------------------
// Verifies the Stripe signature, is idempotent (stripe_events), and only acts on
// events that reference one of OUR scans (bound to the session id we stored, or
// the PaymentIntent metadata we set). Handles success / abandoned / failed.
// Always returns 200 quickly; emails go out in the background.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { constructWebhookEvent, type Stripe } from "../_shared/stripe.ts";
import { notifyOwner } from "../_shared/ownerNotify.ts";
import { sendClientRetry } from "../_shared/sendClientRetry.ts";
import { getOrCreateCustomerId } from "../_shared/customer.ts";

declare const EdgeRuntime:
  | { waitUntil(promise: Promise<unknown>): void }
  | undefined;

function ok(body: unknown = { received: true }): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
function bg(task: Promise<any>) {
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(task);
  else task.catch((e) => console.error("stripe-webhook: bg error", e));
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return ok({ received: true });

  const sig = req.headers.get("stripe-signature");
  const rawBody = await req.text();
  if (!sig) return ok({ received: true }); // not from Stripe; ignore quietly

  let event: Stripe.Event;
  try {
    event = await constructWebhookEvent(rawBody, sig);
  } catch (e) {
    // Bad signature — 400 so Stripe knows, but no internal detail.
    console.error("stripe-webhook: signature verification failed", (e as Error)?.message);
    return new Response(JSON.stringify({ error: "invalid signature" }), { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // --- Idempotency: claim the event id BEFORE processing --------------------
  const { error: idemErr } = await supabase
    .from("stripe_events")
    .insert({ event_id: event.id, type: event.type });
  if (idemErr) {
    // Unique violation => we already handled this event. Do nothing.
    return ok({ received: true, duplicate: true });
  }

  try {
    if (event.type === "checkout.session.completed") {
      await handleCompleted(supabase, event.data.object as Stripe.Checkout.Session);
    } else if (event.type === "checkout.session.expired") {
      await handleExpired(supabase, event.data.object as Stripe.Checkout.Session);
    } else if (event.type === "payment_intent.payment_failed") {
      await handleFailed(supabase, event.data.object as Stripe.PaymentIntent);
    }
    // Any other event type: ignored (already recorded, returns 200).
  } catch (e) {
    console.error("stripe-webhook: handler error", e);
    // Still 200 — Stripe already has the event recorded on our side.
  }

  return ok({ received: true });
});

// deno-lint-ignore no-explicit-any
async function loadOurScan(supabase: any, scanId: string | null, sessionId: string | null) {
  if (!scanId) return null;
  const { data } = await supabase
    .from("scan_requests")
    .select("id, email, domain, normalized_domain, lang, customer_id, status, stripe_session_id")
    .eq("id", scanId)
    .maybeSingle();
  if (!data) return null;
  // Bind to the session we created for this scan (proves it's ours + our price).
  if (sessionId && data.stripe_session_id && data.stripe_session_id !== sessionId) return null;
  return data;
}

// deno-lint-ignore no-explicit-any
async function handleCompleted(supabase: any, session: Stripe.Checkout.Session) {
  const scanId = session.client_reference_id ?? (session.metadata?.scan_request_id ?? null);
  const scan = await loadOurScan(supabase, scanId, session.id);
  if (!scan) return; // not one of ours

  const nowIso = new Date().toISOString();
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : null;

  // Ensure a canonical customer is linked.
  let customerId = scan.customer_id;
  if (!customerId) {
    customerId = await getOrCreateCustomerId(supabase, scan.email ?? session.customer_email, scan.lang);
  }

  await supabase
    .from("payments")
    .update({
      payment_status: "paid",
      paid_at: nowIso,
      stripe_payment_intent: pi,
      amount: session.amount_total ?? null,
      currency: session.currency ?? "eur",
      customer_id: customerId,
    })
    .eq("stripe_session_id", session.id);

  await supabase
    .from("scan_requests")
    .update({
      status: "paid_pending_verification",
      paid_at: nowIso,
      recovery_stopped: true,
      customer_id: customerId,
    })
    .eq("id", scan.id);

  bg(
    notifyOwner({
      event: "paid",
      email: scan.email,
      domain: scan.domain,
      normalizedDomain: scan.normalized_domain,
      amount: session.amount_total ?? null,
      currency: session.currency ?? "eur",
      lang: scan.lang,
      scanRequestId: scan.id,
      customerId,
      status: "paid_pending_verification",
    }),
  );
}

// deno-lint-ignore no-explicit-any
async function handleExpired(supabase: any, session: Stripe.Checkout.Session) {
  const scanId = session.client_reference_id ?? (session.metadata?.scan_request_id ?? null);
  const scan = await loadOurScan(supabase, scanId, session.id);
  if (!scan) return;

  await supabase
    .from("payments")
    .update({ payment_status: "expired" })
    .eq("stripe_session_id", session.id);
  // scan stays 'pending_payment' (eligible for recovery); recovery_stopped stays false.

  bg(
    Promise.all([
      notifyOwner({
        event: "expired",
        email: scan.email,
        domain: scan.domain,
        normalizedDomain: scan.normalized_domain,
        amount: session.amount_total ?? null,
        currency: session.currency ?? "eur",
        lang: scan.lang,
        scanRequestId: scan.id,
        customerId: scan.customer_id,
        status: scan.status,
      }),
      sendClientRetry(supabase, scan.id), // AMENDMENT B: immediate retry
    ]),
  );
}

// deno-lint-ignore no-explicit-any
async function handleFailed(supabase: any, pi: Stripe.PaymentIntent) {
  const scanId = pi.metadata?.scan_request_id ?? null;
  const scan = await loadOurScan(supabase, scanId, null);
  if (!scan) return;

  const reason = pi.last_payment_error?.message ?? pi.last_payment_error?.code ?? "unknown";

  await supabase
    .from("payments")
    .update({
      payment_status: "failed",
      failure_reason: reason,
      stripe_payment_intent: pi.id,
    })
    .eq("scan_request_id", scan.id);
  // scan stays 'pending_payment' (eligible for recovery).

  bg(
    Promise.all([
      notifyOwner({
        event: "failed",
        email: scan.email,
        domain: scan.domain,
        normalizedDomain: scan.normalized_domain,
        amount: pi.amount ?? null,
        currency: pi.currency ?? "eur",
        lang: scan.lang,
        scanRequestId: scan.id,
        customerId: scan.customer_id,
        status: scan.status,
        failureReason: reason,
      }),
      sendClientRetry(supabase, scan.id), // AMENDMENT B: immediate retry
    ]),
  );
}
