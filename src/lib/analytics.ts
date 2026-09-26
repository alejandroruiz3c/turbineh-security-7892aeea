// Fire-and-forget analytics helper. Calls the "track-event" Edge Function.
// Never throws, never blocks the UI. Safe to call from event handlers / effects.
import { supabase } from "@/integrations/supabase/client";

export type TrackEventType =
  | "landing_view"
  | "domain_submitted"
  | "preview_shown"
  | "unlock_clicked"
  | "verify_started"
  | "verified"
  | "report_viewed"
  | "pdf_downloaded"
  | "sample_report_requested";

export function trackEvent(
  event_type: TrackEventType,
  opts: {
    scanRequestId?: string;
    lang?: string;
    meta?: Record<string, unknown>;
  } = {},
): void {
  try {
    const lang =
      opts.lang ?? (typeof document !== "undefined" ? document.documentElement.lang || "es" : "es");
    const body = {
      event_type,
      scanRequestId: opts.scanRequestId,
      lang,
      meta: opts.meta,
    };
    // Fire and forget — swallow all errors.
    void supabase.functions.invoke("track-event", { body }).catch(() => {
      /* ignore */
    });
  } catch {
    /* ignore */
  }
}
