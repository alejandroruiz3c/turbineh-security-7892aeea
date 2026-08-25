// Edge Function: trigger-retry   — RETIRED (410 Gone)
// ---------------------------------------------------------------------------
// Was the "user clicked cancel on Stripe" hook that started the payment-recovery
// email sequence. No payment, no cancel, no retry.
//
// Original implementation: git history, commit 174b0fb ("Phase 8").

import { serveGone } from "../_shared/gone.ts";

serveGone("trigger-retry");
