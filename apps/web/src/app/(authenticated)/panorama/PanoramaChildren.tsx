"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { formatCircuitLabel } from "@/lib/results/exploration";
import { circuitPresentation } from "@/lib/geography/circuit-presentation";
import type { PanoramaData } from "./load-panorama";
import styles from "./panorama.module.css";
import { formatCount, formatDecimal } from "@/lib/format/number";


export function PanoramaChildren({ data, selectedCircuit = null, onClearSelection, onHoverCircuit, onFocusCircuit }: { data: PanoramaData; selectedCircuit?: string | null; onClearSelection?: () => void; onHoverCircuit?: (code: string | null) => void; onFocusCircuit?: (code: string | null) => void }) {
  const [search, setSearch] = useState("");
  const outcomes = data.evidence?.status === "ok" ? data.evidence.circuitOutcomes : undefined;
  const available = outcomes?.status === "ok" && outcomes.circuit_membership === "known";
  const rows = available ? outcomes.circuits.map(circuit => {
    const label = formatCircuitLabel(circuit.circuito_code, data.circuitOptions?.find(item => item.code === circuit.circuito_code));
    const query = new URLSearchParams(data.href.split("?")[1]);
    query.set("level", "circuito");
    query.set("circuitoCode", circuit.circuito_code);
    return { circuit, label, href: `/drilldown?${query}`, presentation: circuitPresentation(circuit) };
  }) : [];
  const matches = (label: string) => label.toLocaleLowerCase("es").includes(search.trim().toLocaleLowerCase("es"));
  const isVisible = (row: typeof rows[number]) => selectedCircuit ? row.circuit.circuito_code === selectedCircuit : matches(row.label);
  const visible = rows.filter(isVisible).length;
  return <section className={styles.children} aria-labelledby="panorama-children-heading">
    <header><div><h2 id="panorama-children-heading">Elegir dónde profundizar</h2><p>Circuitos de la sección seleccionada · resultados oficiales. Buscar no altera el agregado ni su completitud.</p></div><p role="status">{available ? `${visible} visibles · ${rows.length} circuitos disponibles` : "Sin filas disponibles"}</p></header>
    {!available ? <Alert variant="unavailable">Resultados oficiales por circuito no disponibles. No se muestran unidades ni cifras inventadas.</Alert> : <>
      {selectedCircuit && <Alert variant="needs-selection">Circuito seleccionado: {selectedCircuit}. <button type="button" onClick={onClearSelection}>Quitar selección de circuito</button></Alert>}
      <div className={styles.lookup}><label htmlFor="panorama-search">Buscar territorio<input id="panorama-search" type="search" placeholder="Nombre o código de circuito" value={search} onChange={event => { onClearSelection?.(); setSearch(event.target.value); }} /></label><p>Todas las filas permanecen disponibles al limpiar la búsqueda.</p></div>
      <div className={styles.childTable} role="region" aria-label="Circuitos disponibles para profundizar" tabIndex={0}>
        <table><caption>Resultados oficiales por circuito · margen sobre votos positivos</caption><thead><tr><th scope="col">Territorio</th><th scope="col">Primer lugar observado</th><th scope="col">Margen (pp)</th><th scope="col">Votos positivos</th><th scope="col">Completitud</th></tr></thead><tbody>{rows.map(({ circuit, label, href, presentation }) => <tr key={circuit.circuito_code}
          onMouseEnter={() => onHoverCircuit?.(circuit.circuito_code)} onMouseLeave={() => onHoverCircuit?.(null)}
          onFocus={() => onFocusCircuit?.(circuit.circuito_code)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onFocusCircuit?.(null); }}
          hidden={!isVisible({ circuit, label, href, presentation })} aria-selected={selectedCircuit ? selectedCircuit === circuit.circuito_code : undefined}>
          <th scope="row"><a href={href}>{label}</a></th><td>{presentation.winner}{circuit.status === "partial" && " · provisional"}</td><td>{presentation.margin === null ? "No disponible" : `${formatDecimal(presentation.margin)} pp`}</td><td>{formatCount(circuit.positive_total)}</td><td>{circuit.status === "complete" ? "Completa" : `Parcial · ${presentation.coverage}`} · {circuit.counts.counted}/{circuit.counts.expected} mesas</td>
        </tr>)}</tbody></table>
      </div>
      {visible === 0 && <Alert variant="empty">No hay circuitos que coincidan con la búsqueda.</Alert>}
    </>}
  </section>;
}
