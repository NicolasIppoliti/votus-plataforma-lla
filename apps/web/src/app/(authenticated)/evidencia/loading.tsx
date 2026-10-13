import styles from "./evidence.module.css";

export default function EvidenceLoading() {
  return <main className={`page-shell ${styles.root}`}><div className={`shell-container ${styles.layout}`}>
    <header className={styles.header}><p>Espacio de trabajo / Evidencia</p><h1>Evidencia y calidad de datos</h1></header>
    <section className={styles.notice} role="status">Consultando evidencia autorizada… No se muestran cifras ni procedencia hasta validar la selección.</section>
  </div></main>;
}
