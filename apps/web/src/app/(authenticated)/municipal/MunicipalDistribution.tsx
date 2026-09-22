import type { votesByParty } from "@/lib/results/result-rows";
import styles from "./municipal.module.css";

const count = new Intl.NumberFormat("es-AR");

interface MunicipalDistributionProps {
  parties: ReturnType<typeof votesByParty>;
}

export function MunicipalDistribution({ parties }: MunicipalDistributionProps) {
  const maximum = parties.reduce((largest, party) => Math.max(largest, party.votes), 0);

  return (
    <section className={styles.distribution} aria-labelledby="municipal-distribution-heading" aria-describedby="municipal-distribution-scope">
      <header className={styles.chartHeader}>
        <h3 id="municipal-distribution-heading">Votos por partido identificado</h3>
        <p id="municipal-distribution-scope">
          Solo partidos con identidad curada. Las filas sin partido identificado se informan por separado;
          no integran este gráfico ni la tabla por partido. No representa todos los votos emitidos.
        </p>
      </header>
      {parties.length === 0 ? (
        <p role="status">No hay partidos identificados para representar. Consulte el desglose de filas sin partido asignado.</p>
      ) : maximum === 0 ? (
        <>
          <p role="status">Todos los partidos identificados tienen 0 votos; no hay un rango positivo que representar.</p>
          <ul className={styles.zeroSeries}>
            {parties.map((party, index) => <li key={`${party.label}-${index}`}>{party.label}: 0 votos</li>)}
          </ul>
        </>
      ) : (
        <>
          <p className={styles.scaleDescription}>Escala común: de 0 a {count.format(maximum)} votos</p>
          <div className={styles.axis} aria-hidden="true">
            <span>Votos</span>
            <div><span>0</span><span>{count.format(maximum)}</span></div>
          </div>
          <ul className={styles.series}>
            {parties.map((party, index) => (
              <li className={styles.barRow} key={`${party.label}-${index}`}>
                <span className={styles.party}>{party.label}</span>
                <svg className={styles.bar} viewBox="0 0 100 12" preserveAspectRatio="none"
                  role="img" aria-label={`${party.label}: ${count.format(party.votes)} votos`}>
                  <line x1="100" x2="100" y1="0" y2="12" className={styles.gridLine} vectorEffect="non-scaling-stroke" />
                  <rect x="0" y="3" width={party.votes / maximum * 100} height="6" className={styles.mark} />
                  <line x1="0" x2="0" y1="0" y2="12" className={styles.baseline} vectorEffect="non-scaling-stroke" />
                </svg>
                <span className={styles.value} aria-hidden="true">{count.format(party.votes)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
