"use client";
import { useState, type ComponentType } from "react";
import { TableRegion } from "@/components/TableRegion";
import type { OfficialSectionCircuitOutcomes, CircuitOutcome } from "@/lib/workspace/official-section-circuit-outcomes";
import { circuitPresentation, circuitColor } from "@/lib/geography/circuit-presentation";
import type { CircuitMapProps } from "@/components/maps/CircuitReferenceSvg";
import { loadCircuitGeometry } from "./circuit-geometry";
import styles from "./circuits.module.css";

export function CircuitOutcomes({ outcomes, rosales }: { outcomes: OfficialSectionCircuitOutcomes; rosales: boolean }) {
  const [Map, setMap] = useState<ComponentType<CircuitMapProps> | null>(null);
  const [geometry, setGeometry] = useState<CircuitMapProps["geometry"] | null>(null);
  const [loading, setLoading] = useState(false), [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  if (outcomes.status !== "ok") return <p>Resultados por circuito no disponibles.</p>;
  const membershipUnknown = outcomes.circuit_membership === "unknown";
  const parties = new MapConstructor(outcomes.circuits.flatMap(c => c.parties).map(p => p.identity_status === "canonical"
    ? [p.canonical_party_id!, p.display_name!] as const : [`unmapped:${p.list_id}`, `Lista sin mapear ${p.list_id ?? "no identificada"}`] as const));
  async function showMap() {
    setLoading(true); setFailed(false);
    try {
      const [module, asset] = await Promise.all([import("@/components/maps/CircuitReferenceSvg"), loadCircuitGeometry()]);
      if (!asset) throw new Error("Reference unavailable");
      setGeometry(asset); setMap(() => module.CircuitReferenceSvg);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }
  const u = outcomes.unassigned;
  return <section className={styles.root} aria-labelledby="circuit-outcomes-heading">
    <h3 id="circuit-outcomes-heading">Resultados por circuito</h3>
    {membershipUnknown && <p>Pertenencia de mesas a circuitos desconocida: no se muestra un mapa de circuitos.</p>}
    <p>Fuente: oficial · Todas las agrupaciones. Margen: (1.º − 2.º) / votos positivos.</p>
    <p>Supone que todas las mesas esperadas votan las categorías informadas por el distrito.</p>
    <p>Sin asignar a circuito: {u.catalogue_mesas_without_membership} mesas del catálogo; {u.membership_quarantined_mesas} mesas con pertenencia en cuarentena; {u.completeness_quarantines} cuarentenas de completitud; {u.unexpected_status_mesas} estados inesperados.</p>
    {Object.entries(u.membership_quarantine_reasons).map(([reason, n]) => <p key={`m-${reason}`}>Cuarentena de pertenencia · {reason}: {n}</p>)}
    {Object.entries(u.completeness_quarantine_reasons).map(([reason, n]) => <p key={`c-${reason}`}>Cuarentena de completitud · {reason}: {n}</p>)}
    <div aria-label="Leyenda de circuitos">
      <p>Intensidad del margen: &lt;5 pp · claro; 5–15 pp · medio; &gt;15 pp · intenso.</p>
      <p>Empate y Sin votos positivos: neutro. Rayado: escrutinio provisorio.</p>
      <p>Paleta categórica neutral por identidad canónica; no representa colores partidarios oficiales. Listas sin mapear: neutro.</p>
      <ul>{[...parties].map(([id, name]) => <li key={id}><span className={styles.swatch} style={{ background: circuitColor(id.startsWith("unmapped:") ? null : id) }} aria-hidden="true" />{name}</li>)}</ul>
      {rosales && !membershipUnknown && <><p>Geometría de referencia CNE; no certificada como límite electoral 2025</p>
        <p>Fuente: CNE · GeoJSON adjunto a correspondencia del 2026-10-09 (no es fecha de publicación). reference_only · Aplicabilidad electoral desconocida.</p>
        <p>0248B/0248C: superposición en la fuente · área compartida neutra y rayada; sin reparación.</p></>}
    </div>
    {!membershipUnknown && (rosales ? <>
      {!Map && <button type="button" className={styles.select} onClick={showMap} disabled={loading}>{loading ? "Cargando circuitos…" : "Mostrar mapa de circuitos"}</button>}
      {failed && <p role="alert">Geometría no disponible; consulte la tabla exacta.</p>}
      {Map && geometry && <Map geometry={geometry} circuits={outcomes.circuits} selected={selected} onSelect={setSelected} />}
    </> : <p>Geometría de referencia no disponible para esta sección; consulte la tabla exacta.</p>)}
    <p role="status">{selected ? `Circuito seleccionado: ${selected}` : "Elegí un circuito en la tabla o en el mapa."}</p>
    <TableRegion label="Resultados exactos por circuito">
      <table className="data-table"><caption>Resultados exactos por circuito</caption>
        <thead><tr>{["Circuito", "Ganador", "Margen pp", "Votos positivos", "Mesas escrutadas/esperadas", "Estado"].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
        <tbody>{outcomes.circuits.map((c: CircuitOutcome) => {
          const p = circuitPresentation(c);
          return <tr key={c.circuito_code} data-hatched={c.status === "partial"} aria-selected={selected === c.circuito_code}>
            <th scope="row"><button type="button" className={styles.select} aria-pressed={selected === c.circuito_code} onClick={() => setSelected(c.circuito_code)}>{c.circuito_code}</button></th>
            <td>{p.winner}</td><td>{p.margin === null ? "—" : p.margin.toFixed(2)}</td><td>{c.positive_total}</td>
            <td>{c.counts.counted}/{c.counts.expected}</td><td>{p.coverage}
              <div>no escrutadas: {c.counts.not_counted}; sin estado: {c.counts.missing}; inesperadas: {c.counts.unexpected}; cuarentena: {c.counts.quarantined}</div>
            </td></tr>;
        })}</tbody></table>
    </TableRegion>
  </section>;
}
// Avoid shadowing the JS collection with the lazy renderer state.
const MapConstructor = Map;
