"use client";

import { CircuitReferenceSvg } from "@/components/maps/CircuitReferenceSvg";
import { Alert } from "@/components/ui/alert";
import { granularityLabel } from "@/lib/results/granularity";
import { useState } from "react";
import { inspectorDistribution } from "@/lib/results/inspector-distribution";
import { PanoramaChildren } from "./PanoramaChildren";
import { MAP_HEADING, TerritorialMapStage } from "../drilldown/TerritorialMapStage";
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
  const outcomes = ok?.circuitOutcomes;
  const mapped = outcomes?.status === "ok" && outcomes.circuit_membership === "known" && !!data.circuitGeometry?.length;
  const ranked = result ? [...result.parties].sort((a, b) => b.votes - a.votes) : [];
  const tied = ranked.length > 1 && ranked[0]!.votes === ranked[1]!.votes;
  const leader = result && result.totalVotes > 0 && !tied ? ranked[0] : undefined;
  const completeness = ok?.completeness;
  const complete = completeness?.status === "complete";
  const state = !rosales ? "Agregado no disponible para este nivel." : !evidence ? "La selección oficial predeterminada no está disponible." : evidence.status === "authorization_denied" ? "Acceso a resultados oficiales denegado. No se muestran cifras ni procedencia." : evidence.status === "empty" ? "La consulta autorizada no devolvió resultados. Sin datos no significa cero votos." : evidence.status !== "ok" ? `Resultados no disponibles (${evidence.status}). No se muestran cifras parciales.` : complete ? "Completitud oficial verificada para la sección." : "Completitud no confirmada; el primer lugar observado es provisional.";
  return <>
    <section className={styles.context} aria-label="Contexto del panorama">
      <div><span>Vista de datos</span><strong>Resultados oficiales</strong></div>
      <div><label htmlFor="panorama-territory">Territorio</label><select id="panorama-territory" value={territory} onChange={event => setTerritory(event.target.value)}>{["Argentina", "Buenos Aires", "Coronel Rosales"].map(item => <option key={item}>{item}</option>)}</select></div>
      <div><span>Elección</span><strong>{result ? `${result.electionYear} · ${result.electionRound}` : "Sin selección disponible"}</strong></div>
      <div><span>Categoría</span><strong>{result?.categoryName ?? "Sin selección disponible"}</strong></div>
    </section>
    <p className={styles.notice}>Fuente oficial exclusivamente. La geometría CNE es de referencia: no acredita cobertura ni equivalencia electoral histórica; 0248B y 0248C se superponen en la fuente y su área compartida se muestra neutra y rayada.</p>
    <section className={styles.workbench} aria-label="Panorama territorial">
      <div className={styles.map}>
        <nav className={styles.trail} aria-label="Recorrido territorial">{["Argentina", "Buenos Aires", "Coronel Rosales"].map(item => <button key={item} type="button" aria-current={item === territory ? "location" : undefined} onClick={() => setTerritory(item)}>{item}</button>)}</nav>
        <header className={styles.mapTitle}><h2>{territory}</h2><p>Lectura territorial · {rosales ? "Sección 027 · distrito 02" : "Sin agregado autorizado en Panorama"}</p></header>
        {rosales && mapped ? <section className={styles.circuitMap} aria-label="Ganadores por circuito"><h3>Ganadores por circuito</h3><CircuitReferenceSvg geometry={data.circuitGeometry!} circuits={outcomes.circuits} selected={null} /></section> : rosales ? <TerritorialMapStage heading={MAP_HEADING.REFERENCE} title="Coronel Rosales" subtitle="Contorno neutral; no mapa de ganadores por unidad" referenceRosales compact /> : <div className={styles.noMap}><p>Agregado nacional/provincial no disponible.</p><p>Seleccione Coronel Rosales para consultar la sección autorizada. No se suman sus resultados para representar un nivel superior.</p></div>}
      </div>
      <aside className={styles.summary} aria-labelledby="panorama-result-heading">
        <h2 id="panorama-result-heading">Lectura de la selección</h2><Alert variant={result ? "caveat" : evidence?.status === "authorization_denied" ? "denied" : evidence?.status === "empty" ? "empty" : "unavailable"}>{state}</Alert>
        {result && <>
          <div className={styles.leader}><span>{complete ? "Primer lugar observado" : "En cabeza · provisional"}</span><strong>{result.totalVotes === 0 ? "Cero votos" : tied ? "Empate en primer lugar" : leader ? name(leader) : "Sin agrupaciones disponibles"}</strong>
            <div className={styles.metrics}><p><span>Sobre votos positivos</span><b>{leader?.voteShare == null ? "No disponible" : `${formatDecimal(Number(leader.voteShare) * 100)} %`}</b></p><p><span>Margen sobre el segundo</span><b>{leader && ranked.length > 1 && result.totalVotes > 0 ? `${formatDecimal((leader.votes - ranked[1]!.votes) / result.totalVotes * 100)} pp` : "No disponible"}</b></p></div>
          </div>
          <p>Denominador: {formatCount(result.totalVotes)} votos positivos oficiales; no es participación ni padrón.</p>
          <p>Informe: {granularityLabel(result.level)} · fuente: {granularityLabel(result.sourceGranularity)}.</p>
          <a className={styles.exactLink} href={data.href}>Ver resultados exactos en Exploración</a>
        </>}
      </aside>
    </section>
    <PanoramaChildren key={territory} data={rosales ? data : { href: "/drilldown", exclusions: [] }} />
    <details className={styles.supporting}>
      <summary>Fuente y límites</summary>
      {result && <>
          <dl className={styles.totals}><dt>Votos positivos oficiales</dt><dd>{formatCount(result.totalVotes)}</dd><dt>Completitud de mesas</dt><dd>{completeness?.status === "complete" || completeness?.status === "partial" ? `${formatCount(completeness.counts.counted)} / ${formatCount(completeness.counts.expected)}` : "No disponible"}</dd></dl>
          {(completeness?.status === "complete" || completeness?.status === "partial") && <p>No escrutadas: {completeness.counts.not_counted}; faltantes: {completeness.counts.missing}; inesperadas: {completeness.counts.unexpected}; en cuarentena: {completeness.counts.quarantined}; cuarentenas no atribuidas: {completeness.counts.unattributed_quarantined}. Catálogo esperado para las categorías informadas en el distrito.</p>}
          {completeness?.status === "unknown" && <p>Completitud desconocida: {completeness.reason}. {completeness.reason === "section_absent_from_catalogue" && <>Mesas en la fuente: {completeness.unlisted_status_mesas}; cuarentenas: {completeness.quarantined_mesas}; no atribuidas: {completeness.unattributed_quarantined}.</>}</p>}
          <ul className={styles.distribution} aria-label="Distribución de votos positivos oficiales">{inspectorDistribution(result.parties).map((row, index) => <li key={index}><span>{row.name}</span><span>{formatCount(row.votes)} votos · {row.share === null ? "Porcentaje no disponible" : `${formatDecimal(row.share)} %`}</span>{row.share !== null && <meter min={0} max={100} value={row.share} aria-label={`${row.name}: porcentaje de votos positivos`} />}</li>)}</ul>
        </>}
    <section className={styles.observations} aria-labelledby="panorama-observations"><h2 id="panorama-observations">Lo que se puede leer aquí</h2><ul><li>{state}</li><li>Panorama muestra el primer lugar observado y margen por circuito. Los resultados exactos de circuitos, establecimientos, mesas e internas se consultan en Exploración.</li><li>No hay participación, comparación histórica ni pronóstico disponibles en esta lectura.</li></ul></section>
    <section className={styles.evidence} aria-labelledby="official-evidence-heading"><h2 id="official-evidence-heading">Límites y evidencia</h2>
      {data.exclusions.map(item => <p key={item.reason}>Opciones excluidas · {item.reason}: {formatCount(item.rows)} filas.</p>)}
      {result?.sourceExclusions.map(item => <p key={item.kind}>Excluidas del resultado · fuente {item.kind}: {formatCount(item.rows)} filas / {formatCount(item.votes)} votos.</p>)}
      {ok && <>{!mapped && <p>Mapa de ganadores no disponible para esta selección; el contorno permanece neutral.</p>}<details><summary>Procedencia del resultado oficial</summary>{ok.provenance.items.map(item => <p key={item.archiveEntryId}>Archivo {item.archiveEntryId} · {item.capability} · {item.fetchedAt} · sha256 {item.sha256 ?? "no disponible"}</p>)}</details>{ok.provenance.items.filter(item => item.status !== "ok" || !item.sha256).map(item => <p key={item.archiveEntryId}>Verificación de archivo no confirmada: {item.archiveEntryId} · estado {item.status} · {item.sha256 ? "hash suministrado" : "sin hash"}.</p>)}</>}
      {!ok && <p>No hay evidencia interpretable disponible para la selección actual.</p>}
    </section>
    </details>
  </>;
}
