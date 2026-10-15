"use client";
import { ResponsiveSelect } from "@/components/ResponsiveSelect";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import type { OfficialSectionCircuitOutcomes } from "@/lib/workspace/official-section-circuit-outcomes";
import styles from "./evidence.module.css";

export function EvidenceUnits({ membership, rosales }: { membership: OfficialSectionCircuitOutcomes; rosales: boolean }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const circuits = membership.status === "ok" ? membership.circuits : [];
  const visible = circuits.filter(item => item.circuito_code.toLocaleLowerCase("es").includes(search.trim().toLocaleLowerCase("es")) && (status === "all" || item.status === status));
  return <section className={styles.units} aria-labelledby="evidence-units-heading">
    <header className={styles.sectionHeading}><div><h2 id="evidence-units-heading">Inspeccionar las unidades</h2><p>Filas visibles, no denominador de cobertura. La búsqueda no recalcula el mapa ni la completitud de la sección.</p></div>{circuits.length > 0 && <p role="status">{visible.length} de {circuits.length} unidades visibles</p>}</header>
    {membership.status === "ok" && <section aria-label="Mesas y conflictos sin circuito asignado" className={styles.unassigned}>
      <h3>Sin circuito asignado</h3>
      <p>Mesas del catálogo sin pertenencia: {membership.unassigned.catalogue_mesas_without_membership}; mesas en cuarentena de pertenencia: {membership.unassigned.membership_quarantined_mesas}; cuarentenas de completitud: {membership.unassigned.completeness_quarantines}; estados fuera del catálogo: {membership.unassigned.unexpected_status_mesas}.</p>
      {Object.entries(membership.unassigned.membership_quarantine_reasons).map(([reason, count]) => <p role="note" key={`membership-${reason}`}>Pertenencia: {reason}: {count}.</p>)}
      {Object.entries(membership.unassigned.completeness_quarantine_reasons).map(([reason, count]) => <p role="note" key={`completeness-${reason}`}>Completitud: {reason}: {count}.</p>)}
      <p>Los conflictos no atribuibles limitan todos los circuitos; no se descartan para declarar completitud.</p>
    </section>}
    {membership.status !== "ok" ? <Alert variant="unavailable">Pertenencia a circuitos no disponible. No se muestran unidades ni denominadores inventados.</Alert> : membership.circuit_membership === "unknown" ? <Alert variant="caveat">Pertenencia a circuitos desconocida. La fuente no aporta un desglose independiente de mesas esperadas por circuito.</Alert> : <>
      <p>Pertenencia a circuitos conocida según la fuente independiente. Se supone que las mesas del catálogo votan las categorías informadas en el distrito.</p>
      <div className={styles.tableFilters}><div className={styles.field}><label htmlFor="evidence-unit-search">Buscar unidad</label><input type="search" id="evidence-unit-search" placeholder="Código de circuito" value={search} onChange={event => setSearch(event.target.value)} /></div><div className={styles.field}><label htmlFor="evidence-unit-status">Estado del escrutinio</label><ResponsiveSelect id="evidence-unit-status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">Todos los estados</option><option value="complete">Completo</option><option value="partial">Parcial</option></ResponsiveSelect></div></div>
      <div className={styles.tableScroll} role="region" aria-label="Unidades territoriales autorizadas" tabIndex={0}><table><caption>Completitud por circuito · mesas de la fuente independiente</caption><thead><tr><th scope="col">Unidad territorial</th><th scope="col">Disponibilidad</th><th scope="col">Mesas escrutadas / esperadas</th><th scope="col">Referencia geográfica</th></tr></thead><tbody>
        {visible.map(item => <tr key={item.circuito_code}><th scope="row">Circuito {item.circuito_code}<details><summary>Ver límites de lectura</summary><p>{item.counts.not_counted} no escrutadas; {item.counts.missing} sin estado; {item.counts.unexpected} fuera del catálogo; {item.counts.quarantined} en cuarentena.</p><p>{item.status === "complete" ? "Sin faltantes en el catálogo para este circuito." : "Lectura parcial; no interpretar las mesas faltantes como cero. Motivo de origen no informado salvo los estados explícitos de la fuente."}</p></details></th><td>{item.status === "complete" ? "Escrutinio completo" : "Escrutinio parcial"}</td><td>{item.counts.counted}/{item.counts.expected} mesas</td><td>{rosales ? "Referencia CNE; aplicabilidad electoral desconocida" : "No disponible"}</td></tr>)}
      </tbody></table></div>
      {!visible.length && <Alert variant="empty">No hay unidades que coincidan con los filtros. La completitud de la sección no cambió.</Alert>}
    </>}
  </section>;
}
