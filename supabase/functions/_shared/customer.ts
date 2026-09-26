import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
// Get-or-create a canonical customer by email (case-insensitive, no duplicates).
// Backed by the atomic get_or_create_customer() SQL function. Returns the
// customer id, or null when there's no usable email / on error (non-fatal:
// callers still create their row, just without a customer link).

// deno-lint-ignore no-explicit-any
export async function getOrCreateCustomerId(
  supabase: SupabaseClient,
  email: string | null | undefined,
  lang: string | null | undefined,
): Promise<string | null> {
  const e = (email ?? "").toString().trim();
  if (!e) return null;
  const { data, error } = await supabase.rpc("get_or_create_customer", {
    p_email: e,
    p_lang: lang ?? null,
  });
  if (error) {
    console.error("getOrCreateCustomerId: rpc failed", error);
    return null;
  }
  return (data as string) ?? null;
}
