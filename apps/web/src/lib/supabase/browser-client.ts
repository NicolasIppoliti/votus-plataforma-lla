import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client for Client Components (the `/login` form only — every
 * other in-scope route is a Server Component per design.md's "server-only
 * reads"). Uses the browser cookie jar so the session set here is the same
 * one `middleware.ts` and the authenticated layout read on the next
 * request.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  const supabaseUrl = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const supabaseAnonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "See environment-variables.example.txt.",
    );
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
