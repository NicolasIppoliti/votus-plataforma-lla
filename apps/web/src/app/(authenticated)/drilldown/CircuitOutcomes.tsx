"use client";
import { createContext, useContext, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { TableRegion } from "@/components/TableRegion";
import type { OfficialSectionCircuitOutcomes, CircuitOutcome } from "@/lib/workspace/official-section-circuit-outcomes";
import { circuitPresentation } from "@/lib/geography/circuit-presentation";
import { circuitColor, circuitBandColor, Legend, PARTY_COLORS, NEUTRAL_COLOR } from "@/components/maps/reference-colors";
import type { CircuitMapProps } from "@/components/maps/CircuitReferenceSvg";
import { loadCircuitGeometry } from "./circuit-geometry";
import styles from "./circuits.module.css";
import { formatCount, formatFixed2 } from "@/lib/format/number";

const CircuitSelection = createContext<{ selected: string | null; onSelect: (code: string) => void }>({ selected: null, onSelect: () => {} });
export function CircuitSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, onSelect] = useState<string | null>(null);
  return <CircuitSelection.Provider value={{ selected, onSelect }}>{children}</CircuitSelection.Provider>;
}

export function CircuitOutcomes({ outcomes, rosales, circuitNames = {}, view = "table" }: { outcomes: OfficialSectionCircuitOutcomes; rosales: boolean; circuitNames?: Record<string, string>; view?: "map" | "table" | "geometry" | "legend" }) {
  const [Map, setMap] = useState<ComponentType<CircuitMapProps> | null>(null);
  const [geometry, setGeometry] = useState<CircuitMapProps["geometry"] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { selected, onSelect: setSelected } = useContext(CircuitSelection);
  const eligible = (view === "map" || view === "geometry") && rosales && outcomes.status === "ok" && outcomes.circuit_membership === "known";
  useEffect(() => {
    if (!eligible) return;
    let active = true;
    Promise.all([import("@/components/maps/CircuitReferenceSvg"), loadCircuitGeometry()])
      .then(([module, asset]) => {
        if (!active) return;
        if (!asset) throw new Error("Reference unavailable");
        setGeometry(asset); setMap(() => module.CircuitReferenceSvg);
      }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [eligible, attempt]);
  if (outcomes.status !== "ok") return <Alert variant="empty">Resultados por circuito no disponibles.</Alert>;
  const membershipUnknown = outcomes.circuit_membership === "unknown";
  const parties = new MapConstructor(outcomes.circuits.flatMap(c => c.parties).map(p => p.identity_status === "canonical"
    ? [p.canonical_party_id!, p.display_name!] as const : [`unmapped:${p.list_id}`, `Lista sin mapear ${p.list_id ?? "no identificada"}`] as const));
  const u = outcomes.unassigned;
  return <section className={view === "geometry" ? styles.geometry : styles.root} aria-labelledby={view === "map" || view === "geometry" ? "circuit-map-heading" : view === "table" ? "circuit-outcomes-heading" : "circuit-legend-heading"}>
    <h3 className={view === "geometry" ? "sr-only" : undefined} id={view === "map" || view === "geometry" ? "circuit-map-heading" : view === "table" ? "circuit-outcomes-heading" : "circuit-legend-heading"}>{view === "table" ? "Resultados por circuito" : view === "legend" ? "Leyenda de circuitos" : "Mapa de circuitos"}</h3>
    {(view === "map" || view === "geometry") && <>
    {membershipUnknown && <Alert variant="caveat">Pertenencia de mesas a circuitos desconocida: no se muestra un mapa de circuitos.</Alert>}
    {!membershipUnknown && (rosales ? <>
      {!Map && !failed && <Alert variant="caveat">Preparando mapa de circuitos…</Alert>}
      {failed && <><Alert variant="unavailable">Geometría no disponible; consulte la tabla exacta.</Alert><button type="button" className={styles.select} onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Reintentar mapa de circuitos</button></>}
      {Map && geometry && <Map geometry={geometry} circuits={outcomes.circuits} selected={selected} onSelect={setSelected} />}
    </> : <Alert variant="caveat">Geometría de referencia no disponible para esta sección; consulte la tabla exacta.</Alert>)}
    </>}
    {(view === "map" || view === "legend") && <>
    <Legend label="Intensidad del margen" entries={(["light", "medium", "intense"] as const).map((band, index) => ({ label: ["<5 pp · claro", "5–15 pp · medio", ">15 pp · intenso"][index]!, encoding: "fill", color: circuitBandColor(PARTY_COLORS[1], band) }))} />
    <details><summary>Notas de la leyenda</summary>
    <p>Fuente: oficial · Todas las agrupaciones. Margen: (1.º − 2.º) / votos positivos.</p>
    <p>Supone que todas las mesas esperadas votan las categorías informadas por el distrito.</p>
    <p>Sin asignar a circuito: {u.catalogue_mesas_without_membership} mesas del catálogo; {u.membership_quarantined_mesas} mesas con pertenencia en cuarentena; {u.completeness_quarantines} cuarentenas de completitud; {u.unexpected_status_mesas} estados inesperados.</p>
    {Object.entries(u.membership_quarantine_reasons).map(([reason, n]) => <p key={`m-${reason}`}>Cuarentena de pertenencia · {reason}: {n}</p>)}
    {Object.entries(u.completeness_quarantine_reasons).map(([reason, n]) => <p key={`c-${reason}`}>Cuarentena de completitud · {reason}: {n}</p>)}
    <Legend label="Leyenda de circuitos" entries={[
      { label: "Empate, sin votos positivos o lista sin mapear", encoding: "fill", color: NEUTRAL_COLOR },
      { label: "Rayado: escrutinio provisorio o superposición en la fuente", encoding: "hatch" },
    ]}>
      <p>Intensidad del margen: &lt;5 pp · claro; 5–15 pp · medio; &gt;15 pp · intenso.</p>
      <p>Empate y Sin votos positivos: neutro. Rayado: escrutinio provisorio.</p>
      <p>Paleta categórica neutral por identidad canónica; no representa colores partidarios oficiales. Listas sin mapear: neutro.</p>
      <ul>{[...parties].map(([id, name]) => <li key={id}><span className={styles.swatch} style={{ background: circuitColor(id.startsWith("unmapped:") ? null : id) }} aria-hidden="true" />{name}</li>)}</ul>
      {rosales && !membershipUnknown && <><p>Geometría de referencia CNE; no certificada como límite electoral 2025</p>
        <p>Fuente: CNE · GeoJSON adjunto a correspondencia del 2026-10-09 (no es fecha de publicación). reference_only · Aplicabilidad electoral desconocida.</p>
        <p>0248B/0248C: superposición en la fuente · área compartida neutra y rayada; sin reparación.</p></>}
    </Legend>
    </details>
    </>}
    {view !== "geometry" && <Alert variant="needs-selection">{selected ? `Circuito seleccionado: ${selected}` : "Elegí un circuito en la tabla o en el mapa."}</Alert>}
    {view === "table" && <TableRegion label="Resultados exactos por circuito">
      <table className="data-table"><caption>Resultados exactos por circuito</caption>
        <thead><tr>{["Circuito", "Ganador", "Margen pp", "Votos positivos", "Mesas escrutadas/esperadas", "Estado"].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
        <tbody>{outcomes.circuits.map((c: CircuitOutcome) => {
          const p = circuitPresentation(c);
          return <tr key={c.circuito_code} data-hatched={c.status === "partial"} aria-selected={selected === c.circuito_code}>
            <th scope="row"><button type="button" className={styles.select} aria-pressed={selected === c.circuito_code} onClick={() => setSelected(c.circuito_code)}>{c.circuito_code}</button>{circuitNames[c.circuito_code] && circuitNames[c.circuito_code] !== c.circuito_code && <span> — {circuitNames[c.circuito_code]}</span>}</th>
            <td>{p.winner}</td><td>{p.margin === null ? "—" : formatFixed2(p.margin)}</td><td>{formatCount(c.positive_total)}</td>
            <td>{c.counts.counted}/{c.counts.expected}</td><td>{p.coverage}
              <div>no escrutadas: {c.counts.not_counted}; sin estado: {c.counts.missing}; inesperadas: {c.counts.unexpected}; cuarentena: {c.counts.quarantined}</div>
            </td></tr>;
        })}</tbody></table>
    </TableRegion>}
  </section>;
}
// Avoid shadowing the JS collection with the lazy renderer state.
const MapConstructor = Map;
