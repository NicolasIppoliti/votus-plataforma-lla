import type { ExplorationOk } from "@/lib/results/exploration";
import { inspectorDistribution } from "@/lib/results/inspector-distribution";
import { circuitColor } from "@/components/maps/reference-colors";
import styles from "./drilldown.module.css";
import { formatCount, formatFixed2 } from "@/lib/format/number";

const TICKS = [0, 25, 50, 75, 100];

export function InspectorDistribution({ result }: { result: ExplorationOk }) {
  const rows = inspectorDistribution(result.parties).map(row => ({ ...row,
    color: row.grouped ? "var(--muted-ink)" : circuitColor(row.canonicalPartyId),
  }));
  return <section className={styles.inspectorDistribution} aria-label="Distribución de votos">
    <h3>Distribución de votos</h3>
    <div className={styles.compositionStrip} aria-hidden="true">{rows.map(row => row.share === null ? null : <span key={row.name} style={{ width: `${row.share}%`, background: row.color }} />)}</div>
    <ul>{rows.map(row => <li key={row.name}><span><i style={{ background: row.color }} aria-hidden="true" />{row.name}</span><strong>{row.share === null ? "Porcentaje no disponible" : `${formatFixed2(row.share)} %`}</strong></li>)}</ul>
    <p>Fuente oficial · Base: {formatCount(result.totalVotes)} votos partidarios de esta selección; no representa el padrón ni todos los votos emitidos.</p>
  </section>;
}

export function DrilldownDistribution({ result }: { result: ExplorationOk }) {
  return <section className={styles.distribution} aria-labelledby="drilldown-distribution-heading" aria-describedby="drilldown-denominator">
    <header className={styles.chartHeader}>
      <h3 id="drilldown-distribution-heading">Distribución del voto oficial</h3>
      <p id="drilldown-denominator">Base: {formatCount(result.totalVotes)} votos partidarios de esta selección. No representa el padrón ni todos los votos emitidos.</p>
    </header>
    <div className={styles.axis} aria-hidden="true">
      <span>Escala común</span>
      <div>{TICKS.map((tick) => <span key={tick}>{tick} %</span>)}</div>
    </div>
    <ul className={styles.series}>
      {result.parties.map((party, index) => {
        const name = party.identityStatus === "canonical" ? party.displayName : `Lista sin mapear ${party.listId ?? "(ID de lista no disponible)"}`;
        const share = party.voteShare === null ? null : Number(party.voteShare) * 100;
        const label = share === null ? "porcentaje no disponible" : `${formatFixed2(share)} %`;
        return <li className={styles.barRow} key={party.canonicalPartyId ?? `${party.listId}-${index}`}>
          <span className={styles.party}>{name}</span>
          <svg className={styles.bar} viewBox="0 0 100 12" preserveAspectRatio="none" role="img"
            aria-label={`${name}: ${formatCount(party.votes)} votos, ${label}`}>
            {TICKS.map((tick) => <line key={tick} x1={tick} x2={tick} y1="0" y2="12" className={styles.gridLine} vectorEffect="non-scaling-stroke" />)}
            {share === null ? null : <rect x="0" y="3" width={share} height="6" className={styles.mark} />}
            <line x1="0" x2="0" y1="0" y2="12" className={styles.baseline} vectorEffect="non-scaling-stroke" />
          </svg>
          <span className={styles.value} aria-hidden="true">{label}</span>
        </li>;
      })}
    </ul>
  </section>;
}
