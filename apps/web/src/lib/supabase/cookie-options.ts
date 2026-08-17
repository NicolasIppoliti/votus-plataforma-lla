export interface SupabaseCookiePolicyInput {
  environment: string | undefined;
  hostname: string | undefined;
}

export interface ServerRuntimeEnvironment {
  NODE_ENV?: string;
  VOTUS_E2E_BASE_URL?: string;
}

function normalizeHostname(hostname: string | undefined): string | undefined {
  if (hostname === undefined) return undefined;
  const normalized = hostname.toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function isExplicitLoopback(hostname: string | undefined): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === "localhost" ||
    normalized?.endsWith(".localhost") === true ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

/**
 * Shared security attributes for cookies whose names, values, chunking and
 * lifetime remain owned by Supabase.
 */
export function resolveSupabaseCookieOptions({
  environment,
  hostname,
}: SupabaseCookiePolicyInput) {
  return {
    httpOnly: true,
    secure: environment === "production" && !isExplicitLoopback(hostname),
    sameSite: "lax" as const,
    path: "/",
  };
}

function runtimeHostname(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Server Actions and RSCs have no request URL. The existing E2E base URL is
 * the only trusted signal allowed to opt a production loopback gate out of
 * Secure cookies; missing or malformed values therefore fail closed.
 */
export function supabaseCookieOptionsForServerRuntime(
  environment: ServerRuntimeEnvironment = process.env,
) {
  return resolveSupabaseCookieOptions({
    environment: environment.NODE_ENV,
    hostname: runtimeHostname(environment.VOTUS_E2E_BASE_URL),
  });
}
