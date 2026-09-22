import type { ExplorationOk } from "@/lib/results/exploration";
import styles from "./drilldown.module.css";

const percent = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = new Intl.NumberFormat("es-AR");
const TICKS = [0, 25, 50, 75, 100];

export function DrilldownDistribution({ result }: { result: ExplorationOk }) {
  return <section className={styles.distribution} aria-labelledby="drilldown-distribution-heading" aria-describedby="drilldown-denominator">
    <header className={styles.chartHeader}>
      <h3 id="drilldown-distribution-heading">Distribución del voto oficial</h3>
      <p id="drilldown-denominator">Base: {count.format(result.totalVotes)} votos partidarios de esta selección. No representa el padrón ni todos los votos emitidos.</p>
    </header>
    <div className={styles.axis} aria-hidden="true">
      <span>Escala común</span>
      <div>{TICKS.map((tick) => <span key={tick}>{tick} %</span>)}</div>
    </div>
    <ul className={styles.series}>
      {result.parties.map((party, index) => {
        const name = party.identityStatus === "canonical" ? party.displayName : `Lista sin mapear ${party.listId ?? "(ID de lista no disponible)"}`;
        const share = party.voteShare === null ? null : Number(party.voteShare) * 100;
        const label = share === null ? "porcentaje no disponible" : `${percent.format(share)} %`;
        return <li className={styles.barRow} key={party.canonicalPartyId ?? `${party.listId}-${index}`}>
          <span className={styles.party}>{name}</span>
          <svg className={styles.bar} viewBox="0 0 100 12" preserveAspectRatio="none" role="img"
            aria-label={`${name}: ${count.format(party.votes)} votos, ${label}`}>
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
