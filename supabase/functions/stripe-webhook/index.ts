// Edge Function: stripe-webhook   — INERT (410 Gone)
// ---------------------------------------------------------------------------
// The live Stripe webhook endpoint has been DELETED on the Stripe side, so
// nothing should ever reach this URL again. The function is kept deployed and
// inert as a belt-and-braces measure: if any event were still delivered here it
// is refused outright rather than mutating a scan_requests row.
//
// Original signature-verifying implementation: git history, commit 174b0fb.

import { serveGone } from "../_shared/gone.ts";

serveGone("stripe-webhook");
