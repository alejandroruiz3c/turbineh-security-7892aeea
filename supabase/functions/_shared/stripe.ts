// Stripe helper (Deno / Supabase Edge). Uses the official SDK with the Deno
// fetch HTTP client + SubtleCrypto provider for async webhook verification.

import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

export { Stripe };

let _stripe: Stripe | null = null;

/** Lazily construct the Stripe client from STRIPE_SECRET_KEY. */
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  _stripe = new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
    // apiVersion left to the SDK default to avoid literal-type mismatches.
  });
  return _stripe;
}

/** Verify a webhook signature and return the typed event (async / SubtleCrypto). */
export async function constructWebhookEvent(
  rawBody: string,
  signature: string,
): Promise<Stripe.Event> {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not set");
  return await getStripe().webhooks.constructEventAsync(
    rawBody,
    signature,
    secret,
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
}

export interface CheckoutInput {
  scanRequestId: string;
  domain: string; // raw
  normalizedDomain: string;
  email: string;
  lang: "es" | "en";
}

/**
 * Create a Checkout Session for a scan. Shared by create-checkout-session and
 * resume-checkout so the session shape is identical in both places.
 */
export async function createScanCheckout(input: CheckoutInput): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();
  const priceId = Deno.env.get("STRIPE_PRICE_ID");
  if (!priceId) throw new Error("STRIPE_PRICE_ID not set");
  const siteUrl = (Deno.env.get("SITE_URL") || "https://security.turbineh.com").replace(/\/+$/, "");

  const meta = {
    scan_request_id: input.scanRequestId,
    normalized_domain: input.normalizedDomain,
    lang: input.lang,
  };

  return await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: input.email,
    client_reference_id: input.scanRequestId,
    metadata: meta,
    // Propagate metadata to the PaymentIntent so payment_intent.payment_failed
    // can also be mapped back to our scan.
    payment_intent_data: { metadata: meta },
    success_url: `${siteUrl}/verify/${input.scanRequestId}?lang=${input.lang}`,
    // AMENDMENT A: include the scan id on cancel so the frontend can fire an
    // immediate retry email (cancel does NOT emit a webhook event).
    cancel_url: `${siteUrl}/?canceled=1&sid=${input.scanRequestId}`,
    // 30 min – 24 h allowed; 1 hour keeps abandoned sessions expiring promptly.
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
}
