import { createServerClient } from "@supabase/ssr";
import { isAuthApiError, isAuthSessionMissingError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { resolveSupabaseCookieOptions } from "@/lib/supabase/cookie-options";

/**
 * Routes that MUST stay reachable without authentication. Kept to the
 * absolute minimum — the login page itself and its Supabase Auth callback —
 * so no in-scope electoral data route is ever added here by mistake
 * (specs/access-control/spec.md: "No feature in scope MUST be reachable
 * without authentication").
 */
const PUBLIC_ROUTES = new Set(["/login", "/auth/callback"]);
const ENDED_SESSION_CODES = new Set([
  "bad_jwt", "session_not_found", "session_expired", "refresh_token_not_found",
  "refresh_token_already_used", "user_not_found", "user_banned",
]);

function sessionProbeResponse(response: NextResponse, ended: boolean): NextResponse {
  const result = NextResponse.json({ status: ended ? "unauthenticated" : "unavailable" }, {
    status: ended ? 401 : 503,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
  for (const cookie of response.cookies.getAll()) result.cookies.set(cookie);
  return result;
}

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
    cookieOptions: resolveSupabaseCookieOptions({
      environment: process.env["NODE_ENV"],
      hostname: request.nextUrl.hostname,
    }),
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
  let verified;
  try {
    verified = await supabase.auth.getUser();
  } catch (error) {
    if (pathname === "/api/session") return sessionProbeResponse(response, false);
    throw error;
  }
  const { data: { user }, error } = verified;

  // getUser already attempts server-side renewal. Only definitive loss ends an
  // idle page; a transport failure or unrecognized Auth error is not logout.
  if (pathname === "/api/session" && error) {
    const ended = isAuthSessionMissingError(error) || (isAuthApiError(error) &&
      (error.status === 401 || (error.status < 500 && ENDED_SESSION_CODES.has(error.code ?? ""))));
    return sessionProbeResponse(response, ended);
  }

  if (!user) {
    if (pathname === "/api/session") {
      return sessionProbeResponse(response, true);
    }
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
