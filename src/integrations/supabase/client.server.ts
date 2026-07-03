import { createClient } from "@supabase/supabase-js";

const fallbackUrl = "https://hvbjnjerylmbcdnugdcs.supabase.co";
const fallbackPublishableKey = "sb_publishable_uIoGlFBl3BJWttyr8zamtA_MSS8_trS";

export function createSupabasePublicServerClient() {
  return createClient(
    process.env.CUSTOM_SUPABASE_URL ?? fallbackUrl,
    process.env.CUSTOM_SUPABASE_PUBLISHABLE_KEY ?? fallbackPublishableKey,
    {
      auth: {
        storage: undefined,
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

export function createSupabaseAdminClient() {
  const serviceRoleKey = process.env.CUSTOM_SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("CUSTOM_SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  return createClient(process.env.CUSTOM_SUPABASE_URL ?? fallbackUrl, serviceRoleKey, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
