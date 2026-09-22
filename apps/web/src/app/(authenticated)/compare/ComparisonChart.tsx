import type { UnitSwing } from "@/lib/results/compare";
import styles from "./comparison.module.css";

interface Props {
  swing: UnitSwing;
  leftNames: Record<string, string>;
  rightNames: Record<string, string>;
}

const percentage = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = new Intl.NumberFormat("es-AR");
const TICKS = [0, 25, 50, 75, 100];

function ShareBar({ side, name, share }: { side: string; name: string; share: number }) {
  const label = `${side}: ${name}, ${percentage.format(share)} %`;
  return (
    <div className={styles.barRow}>
      <div className={styles.barLabel}><span className={styles.side}>{side}</span><span>{name}</span></div>
      <svg className={styles.bar} viewBox="0 0 100 12" preserveAspectRatio="none" role="img" aria-label={label}>
        {TICKS.map((tick) => <line key={tick} x1={tick} x2={tick} y1="0" y2="12" className={styles.gridLine} vectorEffect="non-scaling-stroke" />)}
        <rect x="0" y="3" width={share} height="6" className={side === "Lado A" ? styles.barA : styles.barB} />
        <line x1="0" x2="0" y1="0" y2="12" className={styles.baseline} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className={styles.value} aria-hidden="true">{percentage.format(share)} %</span>
    </div>
  );
}

export function ComparisonChart({ swing, leftNames, rightNames }: Props) {
  const leftTotal = swing.shares2023.reduce((sum, share) => sum + share.votes, 0);
  const rightTotal = swing.shares2025.reduce((sum, share) => sum + share.votes, 0);
  return (
    <section className={styles.chart} aria-labelledby="compare-chart-heading" aria-describedby="compare-chart-denominator">
      <header className={styles.chartHeader}>
        <h2 id="compare-chart-heading">Participación por partido</h2>
        <p id="compare-chart-denominator">Porcentaje sobre la suma de votos de los partidos incluidos en cada selección. No representa el padrón ni todos los votos emitidos.</p>
        <div className={styles.denominators}>
          <span>Lado A: {count.format(leftTotal)} votos partidarios</span>
          <span>Lado B: {count.format(rightTotal)} votos partidarios</span>
        </div>
      </header>
      <div className={styles.axis} aria-hidden="true">
        <span>Escala común</span>
        <div>{TICKS.map((tick) => <span key={tick}>{tick} %</span>)}</div>
      </div>
      <div className={styles.series}>
        {[...swing.swings].sort((left, right) => left.party.localeCompare(right.party)).map(({ party }) => (
          <div className={styles.pair} key={party}>
            <ShareBar side="Lado A" name={leftNames[party]!} share={swing.shares2023.find((share) => share.party === party)?.sharePercent ?? 0} />
            <ShareBar side="Lado B" name={rightNames[party]!} share={swing.shares2025.find((share) => share.party === party)?.sharePercent ?? 0} />
          </div>
        ))}
      </div>
    </section>
  );
}
