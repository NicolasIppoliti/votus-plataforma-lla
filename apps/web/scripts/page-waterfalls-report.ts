import type { ProfileRoute, ProfileSpanName } from "../src/lib/workspace/profile-span";

export interface Span {
  type: "votus.profile.span"; name: ProfileSpanName; requestId: string; route: ProfileRoute;
  spanId: string; parentSpanId: string | null; startMs: number; durationMs: number; outcome: "ok" | "error";
}
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const RPCS = ["bootstrap_workspace_context", "available_organizations", "current_workspace", "official_facets", "fiscalizacion_coverage", "fiscalizacion_result", "review_items", "official_internal_lists", "official_section_circuit_outcomes", "official_section_completeness", "official_result", "official_schools", "official_reference", "official_provenance", "official_comparison", "switch_workspace_context"];
const NAMES = new Set(["auth.getClaims", "auth.middleware.getUser", "auth.layout.getUser", "page.panorama", "page.drilldown", "page.compare", "panorama.load", "evidence.drilldown", "geometry.section", "geometry.province", "geometry.circuit", ...RPCS.map(name => `workspace.rpc.${name}`)]);
const KEYS = "durationMs,name,outcome,parentSpanId,requestId,route,spanId,startMs,type";
/** Strict projection boundary: unknown payloads are dropped, never forwarded. */
export function parseSpan(line: string): Span | null {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (!value || Object.keys(value).sort().join(",") !== KEYS || value.type !== "votus.profile.span" ||
      typeof value.name !== "string" || !NAMES.has(value.name) ||
      typeof value.requestId !== "string" || !UUID.test(value.requestId) ||
      typeof value.spanId !== "string" || !UUID.test(value.spanId) ||
      !(value.parentSpanId === null || typeof value.parentSpanId === "string" && UUID.test(value.parentSpanId)) ||
      !["/", "/drilldown", "/compare", "/api/session", "other"].includes(String(value.route)) ||
      !["ok", "error"].includes(String(value.outcome)) ||
      typeof value.startMs !== "number" || !Number.isFinite(value.startMs) || value.startMs < 0 ||
      typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0) return null;
    return value as unknown as Span;
  } catch { return null; }
}
export function assertLocalUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("local_endpoint_required");
  return url;
}
export function summarize(values: readonly number[]) {
  if (values.some(value => !Number.isFinite(value) || value < 0)) throw new Error("invalid_timing");
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return { n, medianMs: n ? (sorted[Math.floor((n - 1) / 2)]! + sorted[Math.floor(n / 2)]!) / 2 : null, p95Ms: n ? sorted[Math.ceil(n * 0.95) - 1]! : null };
}
export function intervalUnionMs(spans: readonly Pick<Span, "startMs" | "durationMs">[]): number {
  const intervals = spans.map(span => [span.startMs, span.startMs + span.durationMs] as const).sort((a, b) => a[0] - b[0]);
  let total = 0, end = -Infinity;
  for (const [start, stop] of intervals) { total += Math.max(0, stop - Math.max(start, end)); end = Math.max(end, stop); }
  return total;
}
/** Replace ephemeral trace UUIDs with sample-local indexes; never write identity-bearing payloads. */
export function waterfall(spans: readonly Span[]) {
  const ordered = [...spans].sort((a, b) => a.startMs - b.startMs);
  const origin = ordered[0]?.startMs ?? 0;
  const indexes = new Map(ordered.map((span, index) => [span.spanId, index]));
  const counts: Record<string, number> = {};
  for (const span of ordered) counts[span.name] = (counts[span.name] ?? 0) + 1;
  return {
    counts,
    // This is an observed instrumented envelope, not a SQL plan or a sum of nested spans.
    criticalEnvelopeMs: ordered.length ? Math.max(...ordered.map(span => span.startMs + span.durationMs)) - origin : null,
    coveredMs: intervalUnionMs(ordered),
    spans: ordered.map(span => ({ name: span.name, parent: span.parentSpanId ? indexes.get(span.parentSpanId) ?? null : null, offsetMs: span.startMs - origin, durationMs: span.durationMs, outcome: span.outcome })),
  };
}
