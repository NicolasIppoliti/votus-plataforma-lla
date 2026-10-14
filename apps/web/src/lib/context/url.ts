import { normalizeExplorationParams } from "../results/exploration";

/** National administrative lineage only. PBA partido codes must be resolved by
 * their consumer to national distrito/sección before building a context:
 * Coronel Rosales is distrito 02, sección 027, never distrito 027.
 * Missing election/category remain missing; useful defaults belong to #434.
 * IDs are opaque here; authorized facets validate their existence at the route.
 */
export const ELECTORAL_CONTEXT_KEYS = [
  "electionId", "categoryId", "sourceKind", "distritoCode", "seccionCode",
  "circuitoCode", "establecimientoCode", "mesaCode",
] as const;
export const COMPARISON_CONTEXT_KEYS = ["bElectionId", "bCategoryId"] as const;
export interface ElectoralContext {
  electionId?: string;
  categoryId?: string;
  sourceKind: "official" | "fiscalizacion";
  distritoCode?: string;
  seccionCode?: string;
  circuitoCode?: string;
  establecimientoCode?: string;
  mesaCode?: number;
  bElectionId?: string;
  bCategoryId?: string;
}
export type ElectoralContextSearchParams = Record<string, string | string[] | undefined>;
export type ElectoralContextParseResult =
  | { status: "ok"; value: ElectoralContext }
  | { status: "invalid"; reason: string; counts: Record<string, number> };

/** Unrelated route-local keys are ignored; duplicate context keys are rejected. */
export function parseElectoralContext(raw: ElectoralContextSearchParams | URLSearchParams): ElectoralContextParseResult {
  const values: Record<string, string | undefined> = {};
  const duplicates: Record<string, number> = {};
  for (const key of [...ELECTORAL_CONTEXT_KEYS, ...COMPARISON_CONTEXT_KEYS]) {
    const value = raw instanceof URLSearchParams ? raw.getAll(key) : raw[key];
    if (Array.isArray(value)) {
      if (value.length > 1) duplicates[key] = value.length;
      values[key] = value[0]?.trim() || undefined;
    } else values[key] = value?.trim() || undefined;
  }
  if (Object.keys(duplicates).length) return { status: "invalid", reason: "parámetros de contexto repetidos", counts: duplicates };
  const administrative = normalizeExplorationParams(values);
  if (administrative.status === "invalid") return administrative;
  const sourceKind = values.sourceKind ?? "official";
  if (sourceKind !== "official" && sourceKind !== "fiscalizacion") return { status: "invalid", reason: "fuente no admitida", counts: { sourceKind: 1 } };
  const value: ElectoralContext = { ...administrative.value, sourceKind };
  for (const key of ["electionId", "categoryId", ...COMPARISON_CONTEXT_KEYS] as const) {
    if (values[key]) value[key] = values[key];
  }
  return { status: "ok", value };
}

/** Stable key order; emits the explicit source so context never changes by route. */
export function serializeElectoralContext(context: ElectoralContext): URLSearchParams {
  const raw = Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
  const parsed = parseElectoralContext(raw);
  if (parsed.status === "invalid") throw new Error(parsed.reason);
  const params = new URLSearchParams();
  for (const key of [...ELECTORAL_CONTEXT_KEYS, ...COMPARISON_CONTEXT_KEYS]) {
    const value = parsed.value[key];
    if (value !== undefined) params.set(key, String(value));
  }
  return params;
}
