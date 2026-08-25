// Edge Function: resume-checkout   — RETIRED (410 Gone)
// ---------------------------------------------------------------------------
// Was the link target of the abandoned-payment recovery emails. With payments
// gone there is nothing to resume; the recovery cron is unscheduled too.
//
// Original implementation: git history, commit 174b0fb ("Phase 8").

import { serveGone } from "../_shared/gone.ts";

serveGone("resume-checkout");
