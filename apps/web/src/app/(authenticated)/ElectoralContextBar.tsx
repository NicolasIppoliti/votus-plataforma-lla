"use client";
import { ResponsiveSelect } from "@/components/ResponsiveSelect";

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
const SOURCE_LABELS = { official: "Oficial", fiscalizacion: "Fiscalización — no oficial (opt-in)" } as const;
const DATA_ROUTES = ["/", "/drilldown", "/compare", "/municipal", "/fiscalizacion", "/simulate"];
export function ElectoralContextBar() {
  const pathname = usePathname();
  if (!DATA_ROUTES.some(path => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)))) return null;
  return <WorkspaceControls />;
}
function WorkspaceControls() {
  const snapshot = useWorkspaceSnapshot();
  // #598: no organization yet is a prerequisite, not a failure; nothing to load.
  if (snapshot?.status === "selection_required" || snapshot?.status === "stale") {
    return <section aria-label="Contexto electoral" className="electoral-context shell-container"><Alert variant="needs-selection" presentation="inline">El contexto electoral se habilita al elegir una organización.</Alert></section>;
  }
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
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    // A rejected request (for example a lost connection) is unavailable, never an endless "Cargando…" (#598).
    loadContextOptions(query).then(result => { if (current) setLoaded({ query, result }); }, () => { if (current) setLoaded({ query, result: null }); });
    return () => { current = false; };
  }, [query, attempt]);
  const parsed = parseElectoralContext(new URLSearchParams(query));
  const result = loaded?.query === query ? loaded.result : null;
  const context: ElectoralContext = result?.context ?? (parsed.status === "ok" ? parsed.value : { sourceKind: "official" });
  const facets = result?.facets;
  function change(key: keyof ElectoralContext, value: string) {
    const next = { ...context, [key]: value || undefined };
    const hierarchy = ["electionId", "categoryId", "distritoCode", "seccionCode", "circuitoCode", "establecimientoCode", "mesaCode"] as const;
    const index = hierarchy.indexOf(key as typeof hierarchy[number]);
    if (index >= 0) for (const child of hierarchy.slice(index + 1)) {
      // Category is an electoral dimension, not a parent of the territory.
      if (key === "categoryId" && (child === "distritoCode" || child === "seccionCode")) continue;
      delete next[child];
    }
    const params = new URLSearchParams(query);
    for (const key of ELECTORAL_CONTEXT_KEYS) params.delete(key);
    for (const [key, value] of serializeElectoralContext(next)) params.set(key, value);
    router.push(`${pathname}?${params}`, { scroll: false });
  }
  function selector(label: string, key: keyof ElectoralContext, options: { value: string; label: string }[]) {
    return <label className="electoral-context__field">{label}<ResponsiveSelect aria-label={`Contexto electoral: ${label}`} value={String(context[key] ?? "")} disabled={!facets || parsed.status !== "ok"} onChange={event => change(key, event.target.value)}><option value="">Seleccionar</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</ResponsiveSelect></label>;
  }
  const controls = <>
    {selector("Elección", "electionId", facets?.elections.map(item => ({ value: item.id, label: item.label })) ?? [])}
    {selector("Categoría", "categoryId", facets?.categories.map(item => ({ value: item.id, label: item.name })) ?? [])}
    <fieldset><legend>Territorio</legend>
      {selector("Distrito", "distritoCode", facets?.distritos.map(item => ({ value: item.code, label: formatFacetOptionLabel(item) })) ?? [])}
      {selector("Sección", "seccionCode", facets?.secciones.map(item => ({ value: item.code, label: formatFacetOptionLabel(item) })) ?? [])}
    </fieldset>
    <label className="electoral-context__field">Fuente<ResponsiveSelect aria-label="Contexto electoral: Fuente" value={context.sourceKind} disabled={parsed.status !== "ok"} onChange={event => change("sourceKind", event.target.value)}><option value="official">{SOURCE_LABELS.official}</option><option value="fiscalizacion">{SOURCE_LABELS.fiscalizacion}</option></ResponsiveSelect></label>
  </>;
  const optionLabel = <T,>(items: T[] | undefined, match: (item: T) => boolean, label: (item: T) => string) => {
    const item = items?.find(match);
    return item ? label(item) : undefined;
  };
  const values = [
    optionLabel(facets?.elections, item => item.id === context.electionId, item => item.label),
    optionLabel(facets?.categories, item => item.id === context.categoryId, item => item.name),
    optionLabel(facets?.distritos, item => item.code === context.distritoCode, formatFacetOptionLabel),
    optionLabel(facets?.secciones, item => item.code === context.seccionCode, formatFacetOptionLabel),
    `Fuente: ${SOURCE_LABELS[context.sourceKind]}`,
  ].filter(Boolean).join(" · ");
  return <section ref={barRef} aria-label="Contexto electoral" className="electoral-context shell-container" data-source={context.sourceKind}>
    {/* Exploración's own scope form repeats these controls; on phones fold the
        shared copy behind its values so the map is not pushed down (#501). */}
    {pathname === "/drilldown"
      ? <details className="electoral-context__fold"><summary><strong>Contexto electoral</strong> <span>{values}</span></summary><div className="electoral-context__controls">{controls}</div></details>
      : controls}
    {context.sourceKind === "fiscalizacion" && <Alert variant="caveat" presentation="inline">Fiscalización: fuente no oficial. No se combina con resultados oficiales.</Alert>}
    {parsed.status !== "ok" ? <Alert variant="error" presentation="inline">Contexto inválido: {parsed.reason}</Alert> : loaded?.query === query && !result ? <Alert variant="unavailable" presentation="inline" action={<button type="button" onClick={() => { setLoaded(null); setAttempt(value => value + 1); }}>Reintentar</button>}>No se pudo verificar el contexto autorizado.</Alert> : !facets ? <p role="status">Cargando contexto autorizado…</p> : null}
    <noscript>Los formularios de cada página siguen disponibles sin JavaScript.</noscript>
  </section>;
}
