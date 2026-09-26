import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
// Rate-limiting helper backed by the atomic check_rate_limit() SQL function.
// ---------------------------------------------------------------------------
// Returns true when the request is ALLOWED, false when the limit is exceeded.
// Fails OPEN on an infrastructure error (a rate-limit backend hiccup must not
// take down legitimate traffic).

// deno-lint-ignore no-explicit-any
export async function checkRateLimit(
  supabase: SupabaseClient,
  identifier: string,
  action: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_identifier: identifier,
    p_action: action,
    p_limit: limit,
    p_window_sec: windowSec,
  });
  if (error) {
    console.error("checkRateLimit: rpc failed (failing open)", action, error);
    return true;
  }
  return data === true;
}

/** Friendly 429 body for a given language. */
export function rateLimitBody(lang: "es" | "en" = "es") {
  return {
    error: "rate_limited",
    message:
      lang === "en"
        ? "You've made too many requests. Please wait a little and try again."
        : "Has hecho demasiadas solicitudes. Espera un momento e inténtalo de nuevo.",
  };
}
