import { createClient } from "@supabase/supabase-js";

export const CUSTOM_SUPABASE_URL = "https://hvbjnjerylmbcdnugdcs.supabase.co";
export const CUSTOM_SUPABASE_PROJECT_ID = "hvbjnjerylmbcdnugdcs";
export const CUSTOM_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uIoGlFBl3BJWttyr8zamtA_MSS8_trS";

export const supabase = createClient(CUSTOM_SUPABASE_URL, CUSTOM_SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
