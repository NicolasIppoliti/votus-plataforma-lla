import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Routes that MUST stay reachable without authentication. Kept to the
 * absolute minimum — the login page itself and its Supabase Auth callback —
 * so no in-scope electoral data route is ever added here by mistake
 * (specs/access-control/spec.md: "No feature in scope MUST be reachable
 * without authentication").
 */
const PUBLIC_ROUTES = new Set(["/login", "/auth/callback"]);

/**
 * Supabase Auth session gate for every route in this app, per
 * design.md D1 (Supabase Auth/RLS) and specs/access-control/spec.md.
 *
 * Single authenticated role only: this function branches on
 * "is there a valid session" and nothing else. It MUST NOT read any
 * privilege flag, role claim, or user attribute to decide access — every
 * authenticated user takes the exact same path through this function
 * (specs/access-control/spec.md, "Single authenticated role").
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (PUBLIC_ROUTES.has(pathname)) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const supabaseAnonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: " +
        "cannot evaluate the authentication gate without them. See " +
        "environment-variables.example.txt.",
    );
  }

  // `response` carries any refreshed session cookies Supabase writes during
  // `getUser()`; it becomes the pass-through response on the authenticated
  // path so the browser keeps a fresh session.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() (not getSession()) so the session is revalidated against
  // Supabase Auth on every request rather than trusted from an unverified
  // cookie — required for a hard authentication gate at the edge.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Runs on every route except Next.js internals and static assets, so no
  // in-scope route can be added later without automatically inheriting the
  // gate. Public routes are excluded explicitly above, not via this
  // matcher, so the allow-list stays in one place.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
