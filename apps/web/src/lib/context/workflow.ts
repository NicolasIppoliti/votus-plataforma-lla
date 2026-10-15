import { COMPARISON_CONTEXT_KEYS, ELECTORAL_CONTEXT_KEYS, parseElectoralContext, serializeElectoralContext, type ElectoralContextSearchParams } from "./url";

type SearchParams = ElectoralContextSearchParams | URLSearchParams;
const keys = [...ELECTORAL_CONTEXT_KEYS, ...COMPARISON_CONTEXT_KEYS];

export function hasElectoralContext(search: SearchParams): boolean {
  return keys.some(key => search instanceof URLSearchParams ? search.has(key) : search[key] !== undefined);
}

/** Carry only the shared contract, never a module's local filters. Invalid
 * context remains invalid for the destination guard; never replace it with a
 * different/default official selection. Normalization belongs to url.ts. */
export function workflowHref(path: string, search: SearchParams): string {
  if (!hasElectoralContext(search)) return path;
  const parsed = parseElectoralContext(search);
  let params: URLSearchParams;
  if (parsed.status === "ok") {
    params = serializeElectoralContext(parsed.value);
    // Exploration still requires its route-local level (#437). Infer it from
    // the selected lineage rather than forwarding another module's level.
    const context = parsed.value;
    if (path === "/drilldown" && context.seccionCode) {
      params.set("level", context.mesaCode !== undefined ? "mesa" : context.establecimientoCode ? "establecimiento" : context.circuitoCode ? "circuito" : "seccion");
    }
  } else {
    params = new URLSearchParams();
    for (const key of keys) {
      const value = search instanceof URLSearchParams ? search.getAll(key) : search[key];
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
    }
  }
  return `${path}?${params}`;
}
