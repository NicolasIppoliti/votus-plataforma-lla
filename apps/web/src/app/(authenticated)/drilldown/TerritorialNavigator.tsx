"use client";

import { useState } from "react";
import { Map as MapIcon, ChevronRight } from "lucide-react";
import { canonicalScopeSearchParams, type ScopeControlValues } from "@/components/scope-selector-behavior";
import { useSelectionNavigation } from "./DrilldownSelectionForm";
import styles from "./drilldown.module.css";
import { TerritorialFilterStatus } from "@/components/TerritorialFilterStatus";
import { ElectoralGlossary } from "@/components/ElectoralGlossary";

export interface TerritorialItem { name: string; values: ScopeControlValues }
export function TerritorialNavigator({ items, options, title, terminal }: {
  items: TerritorialItem[]; options: TerritorialItem[]; title: string; terminal: boolean;
}) {
  const { navigate } = useSelectionNavigation();
  const [search, setSearch] = useState("");
  const parent = items.at(-2);
  const currentLevel = items.at(-1)?.values.level;
  const helpField = terminal ? "mesaCode" : ({ distrito: "seccionCode", seccion: "circuitoCode", circuito: "establecimientoCode", establecimiento: "mesaCode" } as Record<string, string>)[currentLevel ?? ""];
  const visible = options.filter(child => child.name.toLocaleLowerCase("es").includes(search.trim().toLocaleLowerCase("es")));
  return <section className={styles.navigator} aria-label="Navegador territorial">
    <div className={styles.navigatorLabel}><MapIcon aria-hidden="true" size={16} /> Navegador territorial</div>
    <div className={styles.navigatorHeading}><h3 id="navigator-title" tabIndex={-1}>{title}</h3>{helpField && <ElectoralGlossary field={helpField} />}</div>
    <nav className={styles.navigatorRoute} aria-label="Ancestros territoriales">
      {items.map((item, index) => index === items.length - 1 ? <span key={index} aria-current="location">{item.name}</span>
        : <a key={index} data-territorial-navigation href={`/drilldown?${canonicalScopeSearchParams(item.values)}`}>{item.name}</a>)}
    </nav>
    {parent && <button type="button" className={styles.navigatorParent} onClick={() => navigate(parent.values)}>Volver a {parent.name}</button>}
    {options.length >= 10 && <div className={styles.navigatorSearch}><label htmlFor="navigator-search">Buscar en el siguiente nivel</label>
      <input id="navigator-search" type="search" placeholder="Buscar por nombre" value={search} onChange={event => setSearch(event.target.value)} />
    </div>}
    <TerritorialFilterStatus visible={visible.length} total={options.length} noMatches={!visible.length && !!options.length && !terminal} />
    <div className={styles.navigatorChildren}>{visible.map(child => <button type="button" className={styles.navigatorChild}
      key={canonicalScopeSearchParams(child.values).toString()} aria-label={`Abrir ${child.name}`} onClick={() => navigate(child.values)}>
      <span>{child.name}</span><ChevronRight aria-hidden="true" className={styles.navigatorArrow} size={20} />
    </button>)}</div>
    {!visible.length && (terminal || !options.length) && <p className={styles.navigatorEmpty}>{terminal ? "Fin del recorrido" : "No hay un siguiente nivel autorizado disponible."}</p>}
  </section>;
}
