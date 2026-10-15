import "server-only";

/** Fixed labels only: never pass route URLs, claims, parameters or error messages. */
export type WorkspaceRpcName = "bootstrap_workspace_context" | "available_organizations" | "current_workspace" | "official_facets" | "fiscalizacion_coverage" | "fiscalizacion_result" | "review_items" | "official_internal_lists" | "official_section_circuit_outcomes" | "official_section_completeness" | "official_result" | "official_schools" | "official_reference" | "official_provenance" | "official_comparison" | "switch_workspace_context";
export type ProfileRoute = "/" | "/drilldown" | "/compare" | "/api/session" | "other";
export interface ProfileContext { requestId: string; route: ProfileRoute; parentSpanId: string | null; }
export const PROFILE_REQUEST_HEADER = "x-votus-profile-request";
export const PROFILE_ROUTE_HEADER = "x-votus-profile-route";
export function profileRoute(pathname: string): ProfileRoute {
  return pathname === "/" || pathname === "/drilldown" || pathname === "/compare" || pathname === "/api/session" ? pathname : "other";
}
export type ProfileSpanName = "auth.getClaims" | "auth.middleware.getUser" | "auth.layout.getUser" | "page.panorama" | "page.drilldown" | "page.compare" | "panorama.load" | "evidence.drilldown" | "geometry.section" | "geometry.province" | "geometry.circuit" | `workspace.rpc.${WorkspaceRpcName}`;

/** Opt-in server diagnostic. Does not cache, retain, or serialize operation results. */
export async function profileSpan<T>(name: ProfileSpanName, operation: () => PromiseLike<T>, context?: ProfileContext, spanId?: string): Promise<T> {
  if (process.env.VOTUS_PROFILE_SPANS !== "1") return operation();
  const start = performance.now();
  const startMs = performance.timeOrigin + start;
  let outcome: "ok" | "error" = "error";
  try {
    const result = await operation();
    outcome = "ok";
    return result;
  } finally {
    // Diagnostics must never change application control flow if the sink fails.
    try {
      console.info(JSON.stringify({ type: "votus.profile.span", name, durationMs: performance.now() - start, outcome,
        ...(context ? { requestId: context.requestId, route: context.route, parentSpanId: context.parentSpanId, spanId: spanId ?? crypto.randomUUID(), startMs } : {}),
      }));
    } catch { /* best-effort diagnostic only */ }
  }
}
