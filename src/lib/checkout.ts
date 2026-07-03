// STUB — real payment integration is a later phase.
// Wire this to Stripe/Paddle when ready.
export function startCheckout(domain: string, email: string | undefined, lang: string) {
  // eslint-disable-next-line no-console
  console.log("[STUB startCheckout]", { domain, email, lang });
  if (typeof window !== "undefined") {
    const q = new URLSearchParams({ lang, domain, ...(email ? { email } : {}) });
    window.location.href = `/success?${q.toString()}`;
  }
}
