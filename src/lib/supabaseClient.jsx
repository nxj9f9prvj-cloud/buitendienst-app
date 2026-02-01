import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase environment variables not found:", {
    hasUrl: !!supabaseUrl,
    hasKey: !!supabaseAnonKey,
  });
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}
