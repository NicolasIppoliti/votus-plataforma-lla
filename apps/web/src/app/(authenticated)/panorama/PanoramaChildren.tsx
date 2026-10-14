"use client";

import { useState } from "react";
import { formatCircuitLabel } from "@/lib/results/exploration";
import { circuitPresentation } from "@/lib/geography/circuit-presentation";
import type { PanoramaData } from "./load-panorama";
import styles from "./panorama.module.css";

const integer = new Intl.NumberFormat("es-AR");
const decimal = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

export function PanoramaChildren({ data }: { data: PanoramaData }) {
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
  const visible = rows.filter(row => matches(row.label)).length;
  return <section className={styles.children} aria-labelledby="panorama-children-heading">
    <header><div><h2 id="panorama-children-heading">Elegir dónde profundizar</h2><p>Circuitos de la sección seleccionada · resultados oficiales. Buscar no altera el agregado ni su completitud.</p></div><p role="status">{available ? `${visible} visibles · ${rows.length} circuitos disponibles` : "Sin filas disponibles"}</p></header>
    {!available ? <p role="status">Resultados oficiales por circuito no disponibles. No se muestran unidades ni cifras inventadas.</p> : <>
      <div className={styles.lookup}><label htmlFor="panorama-search">Buscar territorio<input id="panorama-search" type="search" placeholder="Nombre o código de circuito" value={search} onChange={event => setSearch(event.target.value)} /></label><p>Todas las filas permanecen disponibles al limpiar la búsqueda.</p></div>
      <div className={styles.childTable} role="region" aria-label="Circuitos disponibles para profundizar" tabIndex={0}>
        <table><caption>Resultados oficiales por circuito · margen sobre votos positivos</caption><thead><tr><th scope="col">Territorio</th><th scope="col">Primer lugar observado</th><th scope="col">Margen (pp)</th><th scope="col">Votos positivos</th><th scope="col">Completitud</th></tr></thead><tbody>{rows.map(({ circuit, label, href, presentation }) => <tr key={circuit.circuito_code} hidden={!matches(label)}>
          <th scope="row"><a href={href}>{label}</a></th><td>{presentation.winner}{circuit.status === "partial" && " · provisional"}</td><td>{presentation.margin === null ? "No disponible" : `${decimal.format(presentation.margin)} pp`}</td><td>{integer.format(circuit.positive_total)}</td><td>{circuit.status === "complete" ? "Completa" : `Parcial · ${presentation.coverage}`} · {circuit.counts.counted}/{circuit.counts.expected} mesas</td>
        </tr>)}</tbody></table>
      </div>
      {visible === 0 && <p role="status">No hay circuitos que coincidan con la búsqueda.</p>}
      <p>La completitud se refiere al catálogo esperado para las categorías informadas en el distrito; no es participación ni padrón.</p>
      {outcomes.status === "ok" && <div className={styles.childQualifications}>
        <p>Sin membresía: {outcomes.unassigned.catalogue_mesas_without_membership}; membresías en cuarentena: {outcomes.unassigned.membership_quarantined_mesas}; cuarentenas de completitud: {outcomes.unassigned.completeness_quarantines}; estados inesperados: {outcomes.unassigned.unexpected_status_mesas}.</p>
        {Object.entries(outcomes.unassigned.membership_quarantine_reasons).map(([reason, count]) => <p key={`membership-${reason}`}>Cuarentena de membresía · {reason}: {count}.</p>)}
        {Object.entries(outcomes.unassigned.completeness_quarantine_reasons).map(([reason, count]) => <p key={`completeness-${reason}`}>Cuarentena de completitud · {reason}: {count}.</p>)}
      </div>}
    </>}
  </section>;
}
