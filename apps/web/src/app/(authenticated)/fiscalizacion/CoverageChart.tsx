import styles from "./fiscalizacion.module.css";

const count = new Intl.NumberFormat("es-AR");

export function CoverageChart({ observedUnits, denominatorUnits }: {
  observedUnits: number;
  denominatorUnits: number;
}) {
  return <section className={styles.unitCoverage} aria-labelledby="fiscal-unit-coverage-heading" aria-describedby="fiscal-unit-coverage-scope">
    <h3 id="fiscal-unit-coverage-heading">Cobertura de unidades</h3>
    <p id="fiscal-unit-coverage-scope">La longitud representa unidades observadas, no votos ni una muestra aleatoria.</p>
    {denominatorUnits === 0 ? (
      <p role="status">El denominador oficial es 0; no hay una escala proporcional que representar.</p>
    ) : <>
      <p className={styles.scaleDescription}>Escala: de 0 a {count.format(denominatorUnits)} unidades</p>
      <div className={styles.plot}>
        <div className={styles.axis} aria-hidden="true"><span>0</span><span>{count.format(denominatorUnits)}</span></div>
        <svg className={styles.bar} viewBox="0 0 100 12" preserveAspectRatio="none"
          role="img" aria-label={`${count.format(observedUnits)} de ${count.format(denominatorUnits)} unidades observadas`}>
          <line x1="100" x2="100" y1="0" y2="12" className={styles.gridLine} vectorEffect="non-scaling-stroke" />
          <rect x="0" y="3" width={observedUnits / denominatorUnits * 100} height="6" className={styles.mark} />
          <line x1="0" x2="0" y1="0" y2="12" className={styles.baseline} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </>}
  </section>;
}
