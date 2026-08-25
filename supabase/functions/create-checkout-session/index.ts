// Edge Function: create-checkout-session   — RETIRED (410 Gone)
// ---------------------------------------------------------------------------
// The diagnosis is now 100% free: there is no checkout, no price, no Stripe.
// The flow entry point is start-free-diagnosis. This stub stays deployed only so
// a stale frontend gets an unambiguous 410 instead of silently 404-ing.
//
// Original Stripe implementation: git history, commit 174b0fb ("Phase 8").

import { serveGone } from "../_shared/gone.ts";

serveGone("create-checkout-session");
