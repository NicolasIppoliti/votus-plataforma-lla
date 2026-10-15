"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ELECTORAL_CONTEXT_KEYS, parseElectoralContext, serializeElectoralContext, type ElectoralContext } from "@/lib/context/url";
import { formatFacetOptionLabel } from "@/lib/results/exploration";
import { Alert } from "@/components/ui/alert";
import { useWorkspaceSnapshot } from "./WorkspacePresentation";
import { loadContextOptions } from "./context-actions";

/** Data routes expose electoral selections. Scenarios, evidence and review are
 * workflow/catalog routes, not result selections. Descendants inherit the bar.
 * Page-local forms deliberately remain until #436–#440. */
const DATA_ROUTES = ["/", "/drilldown", "/compare", "/municipal", "/fiscalizacion", "/simulate"];
export function ElectoralContextBar() {
  const pathname = usePathname();
  if (!DATA_ROUTES.some(path => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)))) return null;
  return <WorkspaceControls />;
}
function WorkspaceControls() {
  const snapshot = useWorkspaceSnapshot();
  return <ContextControls key={`${snapshot?.organizationId}/${snapshot?.revision}/${snapshot?.status}`} />;
}
function ContextControls() {
  const barRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = barRef.current;
    const topbar = bar?.parentElement?.querySelector<HTMLElement>(".workspace-topbar");
    if (!bar || !topbar || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    function measure() {
      root.style.setProperty("--electoral-context-height", `${bar!.getBoundingClientRect().height}px`);
      root.style.setProperty("--electoral-topbar-height", `${topbar!.getBoundingClientRect().height}px`);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    observer.observe(topbar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--electoral-context-height");
      root.style.removeProperty("--electoral-topbar-height");
    };
  }, []);
  const search = useSearchParams();
  const query = search.toString();
  const pathname = usePathname();
  const router = useRouter();
  const [loaded, setLoaded] = useState<{ query: string; result: Awaited<ReturnType<typeof loadContextOptions>> } | null>(null);
  useEffect(() => {
    let current = true;
    void loadContextOptions(query).then(result => { if (current) setLoaded({ query, result }); });
    return () => { current = false; };
  }, [query]);
  const parsed = parseElectoralContext(new URLSearchParams(query));
  const result = loaded?.query === query ? loaded.result : null;
  const context: ElectoralContext = result?.context ?? (parsed.status === "ok" ? parsed.value : { sourceKind: "official" });
  const facets = result?.facets;
  function change(key: keyof ElectoralContext, value: string) {
    const next = { ...context, [key]: value || undefined };
    const hierarchy = ["electionId", "categoryId", "distritoCode", "seccionCode", "circuitoCode", "establecimientoCode", "mesaCode"] as const;
    const index = hierarchy.indexOf(key as typeof hierarchy[number]);
    if (index >= 0) for (const child of hierarchy.slice(index + 1)) delete next[child];
    const params = new URLSearchParams(query);
    for (const key of ELECTORAL_CONTEXT_KEYS) params.delete(key);
    for (const [key, value] of serializeElectoralContext(next)) params.set(key, value);
    router.push(`${pathname}?${params}`, { scroll: false });
  }
  function selector(label: string, key: keyof ElectoralContext, options: { value: string; label: string }[]) {
    return <label className="electoral-context__field">{label}<select aria-label={`Contexto electoral: ${label}`} value={String(context[key] ?? "")} disabled={!facets || parsed.status !== "ok"} onChange={event => change(key, event.target.value)}><option value="">Seleccionar</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
  }
  return <section ref={barRef} aria-label="Contexto electoral" className="electoral-context shell-container" data-source={context.sourceKind}>
    {selector("Elección", "electionId", facets?.elections.map(item => ({ value: item.id, label: item.label })) ?? [])}
    {selector("Categoría", "categoryId", facets?.categories.map(item => ({ value: item.id, label: item.name })) ?? [])}
    <fieldset><legend>Territorio</legend>
      {selector("Distrito", "distritoCode", facets?.distritos.map(item => ({ value: item.code, label: formatFacetOptionLabel(item) })) ?? [])}
      {selector("Sección", "seccionCode", facets?.secciones.map(item => ({ value: item.code, label: formatFacetOptionLabel(item) })) ?? [])}
    </fieldset>
    <label className="electoral-context__field">Fuente<select aria-label="Contexto electoral: Fuente" value={context.sourceKind} disabled={parsed.status !== "ok"} onChange={event => change("sourceKind", event.target.value)}><option value="official">Oficial</option><option value="fiscalizacion">Fiscalización — no oficial (opt-in)</option></select></label>
    {context.sourceKind === "fiscalizacion" && <Alert>Fiscalización: fuente no oficial. No se combina con resultados oficiales.</Alert>}
    {parsed.status !== "ok" ? <Alert>Contexto inválido: {parsed.reason}</Alert> : loaded?.query === query && !result ? <Alert>No se pudo verificar el contexto autorizado.</Alert> : !facets ? <p role="status">Cargando contexto autorizado…</p> : null}
    <noscript>Los formularios de cada página siguen disponibles sin JavaScript.</noscript>
  </section>;
}
