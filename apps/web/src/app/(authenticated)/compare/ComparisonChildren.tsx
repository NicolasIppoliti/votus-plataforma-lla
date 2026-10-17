"use client";
import { TerritorialFilterStatus } from "@/components/TerritorialFilterStatus";
import { ResponsiveSelect } from "@/components/ResponsiveSelect";

import { useState } from "react";
import type { CircuitOutcome, OfficialSectionCircuitOutcomes } from "@/lib/workspace/official-section-circuit-outcomes";
import { TableRegion } from "@/components/TableRegion";
import { Alert } from "@/components/ui/alert";
import styles from "./comparison.module.css";
import { formatCount, formatFixed2 } from "@/lib/format/number";
import { facetExclusionLabel } from "@/lib/results/facet-exclusion-labels";

interface Row { code: string; reason: string | null; a: number | null; b: number | null; change: number | null; voteChange: number | null }
function reason(a: CircuitOutcome | undefined, b: CircuitOutcome | undefined): string | null {
  if (!a || !b) return "Sin observación en ambos lados";
  if (a.status !== "complete" || b.status !== "complete") return "Cobertura parcial";
  if (a.positive_total === 0 || b.positive_total === 0) return "Total incluido igual a cero";
  if ([...a.parties, ...b.parties].some(p => p.identity_status !== "canonical")) return "Correspondencia sin resolver";
  return null;
}
function selected(c: CircuitOutcome | undefined, id: string) { return c?.parties.find(p => p.identity_status === "canonical" && p.canonical_party_id === id); }

export function ComparisonChildren({ outcomes, party }: { outcomes: [OfficialSectionCircuitOutcomes, OfficialSectionCircuitOutcomes]; party: string }) {
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState("descending");
  const [left, right] = outcomes;
  const available = left.status === "ok" && right.status === "ok" && left.circuit_membership === "known" && right.circuit_membership === "known";
  const rows: Row[] = available ? [...new Set([...left.circuits, ...right.circuits].map(c => c.circuito_code))].map(code => {
    const a = left.circuits.find(c => c.circuito_code === code), b = right.circuits.find(c => c.circuito_code === code);
    const blocked = reason(a, b);
    const selectedA = selected(a, party), selectedB = selected(b, party);
    const excluded = blocked ?? (!selectedA || !selectedB ? "Agrupación sin observación en ambos lados" : null);
    const shareA = !excluded ? selectedA!.votes / a!.positive_total * 100 : null;
    const shareB = !excluded ? selectedB!.votes / b!.positive_total * 100 : null;
    return { code, reason: excluded, a: shareA, b: shareB, change: shareA === null || shareB === null ? null : shareB - shareA,
      voteChange: excluded ? null : selectedB!.votes - selectedA!.votes };
  }) : [];
  const excluded = new Map<string, number>();
  for (const row of rows) if (row.reason) excluded.set(row.reason, (excluded.get(row.reason) ?? 0) + 1);
  const visible = [...rows].sort((a, b) => (a.change === null ? 1 : 0) - (b.change === null ? 1 : 0) ||
    (a.change !== null && b.change !== null ? (order === "descending" ? b.change - a.change : a.change - b.change) : 0) || a.code.localeCompare(b.code, "es"))
    .filter(row => row.code.toLocaleLowerCase("es").includes(search.trim().toLocaleLowerCase("es")));
  const format = (value: number | null, suffix: string, signed = false) => value === null ? "No disponible" : `${signed && value > 0 ? "+" : ""}${formatFixed2(value)} ${suffix}`;
  return <section className={styles.children} aria-labelledby="compare-child-heading">
    <header><div><h2 id="compare-child-heading">Cambio por territorio</h2><p>Circuitos · agrupación seleccionada · B − A</p></div>
      <details className={styles.selectionNotes} data-child-controls="" open={available}><summary>Controles del siguiente nivel</summary><div className={styles.childControls}><div><label htmlFor="compare-child-search">Filtrar territorios de la tabla</label><input id="compare-child-search" type="search" placeholder="Buscar por código" disabled={!available} value={search} onChange={event => setSearch(event.target.value)} /></div>
        <div><label htmlFor="compare-child-order">Ordenar territorios</label><ResponsiveSelect id="compare-child-order" disabled={!available} value={order} onChange={event => setOrder(event.target.value)}><option value="descending">Mayor cambio en pp</option><option value="ascending">Menor cambio en pp</option></ResponsiveSelect></div></div></details></header>
    <TerritorialFilterStatus visible={visible.length} total={rows.length} noMatches={available && !visible.length && !!search.trim()} />
    {!available ? <Alert variant="caveat">Comparabilidad del siguiente nivel no disponible: se requiere pertenencia oficial de mesas a circuitos en ambas elecciones. No se reemplazan ausencias con cero.</Alert> : <>
      <div className={styles.coverage}><p role="status">{rows.filter(row => !row.reason).length} de {rows.length} pares comparables para la agrupación seleccionada</p>
        <ul aria-label="Motivos de exclusión del siguiente nivel">{[...excluded].map(([label, count]) => <li key={label}>{label}: {count}</li>)}</ul>
        <p>Todos los circuitos informados en cualquiera de los lados; la búsqueda no cambia la cobertura. Los códigos no certifican equivalencia de límites históricos.</p>
        {[left, right].map((side, index) => side.status === "ok" && <div key={index}><p>Lado {index === 0 ? "A" : "B"}: mesas sin pertenencia {side.unassigned.catalogue_mesas_without_membership}; pertenencias en cuarentena {side.unassigned.membership_quarantined_mesas}; cuarentenas de completitud {side.unassigned.completeness_quarantines}; estados inesperados {side.unassigned.unexpected_status_mesas}.</p>
          <ul>{Object.entries(side.unassigned.membership_quarantine_reasons).map(([label, count]) => <li key={`membership-${label}`}>{facetExclusionLabel(label)}: {count}</li>)}{Object.entries(side.unassigned.completeness_quarantine_reasons).map(([label, count]) => <li key={`completeness-${label}`}>{facetExclusionLabel(label)}: {count}</li>)}</ul></div>)}
      </div>
      <TableRegion label="Tabla de cambio por circuito"><table className="data-table"><caption>Cambio por circuito sobre votos positivos incluidos</caption><thead><tr><th scope="col">Territorio</th><th scope="col">Estado del par</th><th scope="col">Participación A</th><th scope="col">Participación B</th><th scope="col">Cambio B − A</th><th scope="col">Votos B − A</th></tr></thead><tbody>{visible.map(row => <tr key={row.code}><th scope="row">Circuito {row.code}</th><td>{row.reason ?? "Observaciones completas; límites históricos sin verificar"}</td><td>{format(row.a, "%")}</td><td>{format(row.b, "%")}</td><td>{format(row.change, "pp", true)}</td><td>{row.voteChange === null ? "No disponible" : `${row.voteChange > 0 ? "+" : ""}${formatCount(row.voteChange)} votos`}</td></tr>)}</tbody></table></TableRegion>
    </>}
  </section>;
}
