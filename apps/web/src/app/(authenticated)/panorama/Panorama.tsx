"use client";
import { ResponsiveSelect } from "@/components/ResponsiveSelect";

import { CircuitReferenceSvg } from "@/components/maps/CircuitReferenceSvg";
import { Alert } from "@/components/ui/alert";
import { RosalesAdministrativeDetails, RosalesTerritoryName } from "@/components/RosalesAdministrativeContext";
import { granularityLabel } from "@/lib/results/granularity";
import { useEffect, useState } from "react";
import { inspectorDistribution } from "@/lib/results/inspector-distribution";
import { PanoramaChildren } from "./PanoramaChildren";
import { TerritorialMapStage } from "../drilldown/TerritorialMapStage";
import { MAP_HEADING } from "../drilldown/map-heading";
import type { PanoramaData } from "./load-panorama";
import styles from "./panorama.module.css";
import { formatCount, formatDecimal } from "@/lib/format/number";

const name = (party: { identityStatus: string; displayName: string | null }) => party.identityStatus === "unmapped" ? "Agrupación sin correspondencia canónica" : party.displayName ?? "Agrupación sin nombre";

export function Panorama({ data }: { data: PanoramaData }) {
  const [territory, setTerritory] = useState("Coronel Rosales");
  const rosales = territory === "Coronel Rosales";
  const evidence = rosales ? data.evidence : undefined;
  const ok = evidence?.status === "ok" ? evidence : undefined;
  const result = ok?.result;
  const [requestedCircuit, setRequestedCircuit] = useState<string | null>(null);
  const [hoveredCircuit, setHoveredCircuit] = useState<string | null>(null);
  const [focusedCircuit, setFocusedCircuit] = useState<string | null>(null);
  const circuits = ok?.circuitOutcomes;
  const selectable = rosales && circuits?.status === "ok" && circuits.circuit_membership === "known";
  const mapped = selectable && !!data.circuitGeometry?.length;
  const selectedCircuit = selectable && circuits.circuits.some(c => c.circuito_code === requestedCircuit) ? requestedCircuit : null;
  useEffect(() => {
    const restore = () => setRequestedCircuit(new URL(window.location.href).searchParams.get("selectedCircuit"));
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const selectCircuit = (code: string | null) => {
    if (code && (!selectable || !circuits.circuits.some(c => c.circuito_code === code))) return;
    const url = new URL(window.location.href);
    if (code) url.searchParams.set("selectedCircuit", code);
    else url.searchParams.delete("selectedCircuit");
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
    setRequestedCircuit(code);
  };
  const clearHighlight = () => { setHoveredCircuit(null); setFocusedCircuit(null); };
  const selectTerritory = (value: string) => { clearHighlight(); selectCircuit(null); setTerritory(value); };
  const ranked = result ? [...result.parties].sort((a, b) => b.votes - a.votes) : [];
  const tied = ranked.length > 1 && ranked[0]!.votes === ranked[1]!.votes;
  const leader = result && result.totalVotes > 0 && !tied ? ranked[0] : undefined;
  const completeness = ok?.completeness;
  const complete = completeness?.status === "complete";
  const state = !rosales ? "Agregado no disponible para este nivel." : !evidence ? "La selección oficial predeterminada no está disponible." : evidence.status === "authorization_denied" ? "Acceso a resultados oficiales denegado. No se muestran cifras ni procedencia." : evidence.status === "empty" ? "La consulta autorizada no devolvió resultados. Sin datos no significa cero votos." : evidence.status !== "ok" ? `Resultados no disponibles (${evidence.status}). No se muestran cifras parciales.` : complete ? "Completitud oficial verificada para la sección." : "Completitud no confirmada; el primer lugar observado es provisional.";
  return <>
    <section className={styles.context} aria-label="Contexto del panorama">
      <div><span>Vista de datos</span><strong className={styles.sourceBadge}>Resultados oficiales</strong></div>
      <div><label htmlFor="panorama-territory">Territorio</label><ResponsiveSelect id="panorama-territory" value={territory} onChange={event => selectTerritory(event.target.value)}>{["Argentina", "Buenos Aires", "Coronel Rosales"].map(item => <option key={item}>{item}</option>)}</ResponsiveSelect></div>
      <div><span>Elección</span><strong>{result ? `${result.electionYear} · ${result.electionRound}` : "Sin selección disponible"}</strong></div>
      <div><span>Categoría</span><strong>{result?.categoryName ?? "Sin selección disponible"}</strong></div>
    </section>
    <section className={styles.workbench} aria-label="Panorama territorial">
      <div className={styles.map}>
        <nav className={styles.trail} aria-label="Recorrido territorial">{["Argentina", "Buenos Aires", "Coronel Rosales"].map(item => <button key={item} type="button" aria-current={item === territory ? "location" : undefined} onClick={() => selectTerritory(item)}>{item}</button>)}</nav>
        <header className={styles.mapTitle}><h2>{territory}</h2><p>Lectura territorial · {rosales ? <RosalesTerritoryName /> : "Sin agregado autorizado en Panorama"}</p></header>
        {rosales && <RosalesAdministrativeDetails />}
        {mapped ? <section className={styles.circuitMap} aria-label="Ganadores por circuito"><h3>Ganadores por circuito</h3><CircuitReferenceSvg geometry={data.circuitGeometry!} circuits={circuits.circuits} selected={selectedCircuit} highlighted={selectable ? focusedCircuit ?? hoveredCircuit : null} onSelect={selectCircuit} /></section> : rosales ? <TerritorialMapStage heading={MAP_HEADING.REFERENCE} title="Coronel Rosales" subtitle="Contorno de la sección seleccionada" referenceRosales compact consolidatedLimits /> : <div className={styles.noMap}><p>Agregado nacional/provincial no disponible.</p><p>Seleccione Coronel Rosales para consultar la sección autorizada. No se suman sus resultados para representar un nivel superior.</p></div>}
      </div>
      <aside className={styles.summary} aria-labelledby="panorama-result-heading">
        <h2 id="panorama-result-heading">Lectura de la selección</h2><Alert variant={result ? "caveat" : evidence?.status === "authorization_denied" ? "denied" : evidence?.status === "empty" ? "empty" : "unavailable"}>{state}</Alert>
        {result && <>
          <div className={styles.leader}><span>{complete ? "Primer lugar observado" : "En cabeza · provisional"}</span><strong>{result.totalVotes === 0 ? "Cero votos" : tied ? "Empate en primer lugar" : leader ? name(leader) : "Sin agrupaciones disponibles"}</strong>
            <div className={styles.metrics}><p><span>Sobre votos positivos</span><b>{leader?.voteShare == null ? "No disponible" : `${formatDecimal(Number(leader.voteShare) * 100)} %`}</b></p><p><span>Margen sobre el segundo</span><b>{leader && ranked.length > 1 && result.totalVotes > 0 ? `${formatDecimal((leader.votes - ranked[1]!.votes) / result.totalVotes * 100)} pp` : "No disponible"}</b></p></div>
          </div>

          <a className={styles.exactLink} href={data.href}>Ver resultados exactos en Exploración</a>
        </>}
      </aside>
    </section>
    <PanoramaChildren key={territory} data={rosales ? data : { href: "/drilldown", exclusions: [] }} selectedCircuit={selectedCircuit} onClearSelection={() => { clearHighlight(); selectCircuit(null); }} onHoverCircuit={setHoveredCircuit} onFocusCircuit={setFocusedCircuit} />
    <details className={styles.evidence}>
      <summary id="official-evidence-heading">Fuente y límites</summary>
      <p>Fiscalización es una fuente no oficial, de consulta separada; sus cifras no se combinan con las de este panorama.</p>
      <p>La geometría CNE es referencia geográfica, no cobertura electoral. Geometría no certificada como límite electoral 2025. Aplicabilidad electoral desconocida; no acredita equivalencia histórica.</p>
      <p>Fuente geográfica: CNE · recuperada el 24/09/2026. {mapped ? "0248B y 0248C se superponen en la fuente; su área compartida se muestra neutra y rayada." : "Contorno ancestro; sin geometría propia para unidades inferiores ni mapa de ganadores disponible para esta selección."}</p>
      <p>Panorama muestra el primer lugar observado y margen por circuito cuando están disponibles. Los resultados exactos de circuitos, establecimientos, mesas e internas se consultan en Exploración.</p>
      <p>No hay participación, comparación histórica ni pronóstico disponibles en esta lectura.</p>
      <p>Las consultas conservan el alcance de cada fuente. La disponibilidad depende del territorio y del acceso autorizado.</p>
      {result && <>
        <dl className={styles.totals}><dt>Votos positivos oficiales</dt><dd>{formatCount(result.totalVotes)}</dd><dt>Completitud de mesas</dt><dd>{completeness?.status === "complete" || completeness?.status === "partial" ? `${formatCount(completeness.counts.counted)} / ${formatCount(completeness.counts.expected)}` : "No disponible"}</dd></dl>
        <ul className={styles.distribution} aria-label="Distribución de votos positivos oficiales">{inspectorDistribution(result.parties).map((row, index) => <li key={index}><span>{row.name}</span><span>{formatCount(row.votes)} votos · {row.share === null ? "Porcentaje no disponible" : `${formatDecimal(row.share)} %`}</span>{row.share !== null && <meter min={0} max={100} value={row.share} aria-label={`${row.name}: porcentaje de votos positivos`} />}</li>)}</ul>
        <p>Denominador de porcentajes y margen: {formatCount(result.totalVotes)} votos positivos suministrados; no es participación ni padrón. La completitud se refiere al catálogo esperado para las categorías informadas en el distrito.</p>
        <p>Nivel del informe: {granularityLabel(result.level)}. Granularidad real de la fuente: {granularityLabel(result.sourceGranularity)}.</p>
      </>}
      {(completeness?.status === "complete" || completeness?.status === "partial") && <p>No escrutadas: {completeness.counts.not_counted}; faltantes: {completeness.counts.missing}; inesperadas: {completeness.counts.unexpected}; en cuarentena: {completeness.counts.quarantined}; cuarentenas no atribuidas: {completeness.counts.unattributed_quarantined}.</p>}
      {completeness?.status === "unknown" && <p>Completitud desconocida: {completeness.reason}. {completeness.reason === "section_absent_from_catalogue" && <>Mesas en la fuente: {completeness.unlisted_status_mesas}; cuarentenas: {completeness.quarantined_mesas}; no atribuidas: {completeness.unattributed_quarantined}.</>}</p>}
      {circuits?.status === "ok" && circuits.circuit_membership === "known" && <div className={styles.childQualifications}>
        <p>Sin membresía: {circuits.unassigned.catalogue_mesas_without_membership}; membresías en cuarentena: {circuits.unassigned.membership_quarantined_mesas}; cuarentenas de completitud: {circuits.unassigned.completeness_quarantines}; estados inesperados: {circuits.unassigned.unexpected_status_mesas}.</p>
        {Object.entries(circuits.unassigned.membership_quarantine_reasons).map(([reason, count]) => <p key={`membership-${reason}`}>Cuarentena de membresía · {reason}: {count}.</p>)}
        {Object.entries(circuits.unassigned.completeness_quarantine_reasons).map(([reason, count]) => <p key={`completeness-${reason}`}>Cuarentena de completitud · {reason}: {count}.</p>)}
      </div>}
      {rosales && evidence?.status !== "authorization_denied" && data.exclusions.map(item => <p key={item.reason}>Opciones excluidas · {item.reason}: {formatCount(item.rows)} filas.</p>)}
      {result?.sourceExclusions.map(item => <p key={item.kind}>Excluidas del resultado · fuente {item.kind}: {formatCount(item.rows)} filas / {formatCount(item.votes)} votos.</p>)}
      {ok && <><h3>Procedencia del resultado oficial</h3>{ok.provenance.items.map(item => <p key={item.archiveEntryId}>Archivo {item.archiveEntryId} · {item.capability} · {item.fetchedAt} · sha256 {item.sha256 ?? "no disponible"}</p>)}{ok.provenance.items.filter(item => item.status !== "ok" || !item.sha256).map(item => <p key={item.archiveEntryId}>Verificación de archivo no confirmada: {item.archiveEntryId} · estado {item.status} · {item.sha256 ? "hash suministrado" : "sin hash"}.</p>)}</>}

      {!ok && <p>No hay evidencia interpretable disponible para la selección actual.</p>}
    </details>
  </>;
}
