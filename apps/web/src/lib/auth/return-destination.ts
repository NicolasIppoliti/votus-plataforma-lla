/** Shared by Edge middleware, server actions and the browser; no runtime directives. */
/**
 * UTF-16 code units of the original destination, before login URL encoding.
 * Shipped Rosales scenario/editor/transfer/sweep URLs measured up to 2,542
 * characters (scenario-return-budget.test.ts). 8,192 leaves >3x headroom.
 * Caller-authored scenarios are not inherently bounded: oversized links fall
 * back to the briefing, never truncate JSON or silently change the scenario.
 */
export const MAX_RETURN_DESTINATION_LENGTH = 8192;
const RETURN_ROUTES = new Set([
  "/", "/dashboard", "/drilldown", "/compare", "/simulate", "/municipal", "/onboarding",
  "/fiscalizacion", "/review", "/scenarios", "/evidencia",
]);

/**
 * This is a navigation allow-list, not electoral validation or authorization.
 * Keep the original query bytes (including rich supplied scenarios); the route
 * owns canonical selection parsing and fresh authorized reads after sign-in.
 */
export function returnDestination(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_RETURN_DESTINATION_LENGTH || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (/[\\\s#]/.test(value)) return "/";
  const pathname = value.split("?", 1)[0]!;
  try {
    const decodedPathname = decodeURIComponent(pathname);
    if (decodedPathname.includes("//") || decodedPathname.includes("\\") || !RETURN_ROUTES.has(pathname)) return "/";
    // Only exact literal allow-listed paths can reach this point. Encoded /
    // and \\ in query values are data, not URL authority/path separators:
    // /compare?x=%5C and /compare?x=%2F%2Fevil.test stay on /compare.
    // Never decode the destination before redirecting: that could promote
    // query data into URL syntax. Preserve its original encoded bytes instead.
    // URLSearchParams is deliberately forgiving of malformed percent escapes;
    // reject them here rather than silently repairing an untrusted destination.
    const decoded = decodeURIComponent(value);
    if (/[\u0000-\u001f\u007f]/.test(decoded)) return "/";
  } catch {
    return "/";
  }
  return value;
}

export function loginDestination(value: unknown): string {
  const destination = returnDestination(value);
  return destination === "/" ? "/login" : `/login?${new URLSearchParams({ returnTo: destination })}`;
}
