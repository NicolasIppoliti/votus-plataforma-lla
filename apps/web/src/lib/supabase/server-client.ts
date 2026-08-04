import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client for React Server Components / Server Actions, using the
 * `next/headers` cookie jar (distinct API from `middleware.ts`'s
 * request/response cookies, so the two are not shared helpers).
 *
 * This is the second, independent authentication check referenced by
 * design.md D1 and task 9.6: `middleware.ts` gates every request at the
 * edge, and `(authenticated)/layout.tsx` gates again at render time so no
 * in-scope route can serve data without a verified session even if a
 * future route bypasses the middleware matcher.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const supabaseUrl = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const supabaseAnonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: " +
        "cannot evaluate the authentication gate without them. See " +
        "environment-variables.example.txt.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // A Server Component cannot write cookies; session refresh is
        // handled by `middleware.ts`, which runs before every request.
        // Swallowing this here (rather than throwing) matches Supabase's
        // documented App Router pattern.
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Expected when called from a Server Component render.
        }
      },
    },
  });
}
