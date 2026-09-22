import type { ReactNode } from "react";
import styles from "./fiscalizacion.module.css";
import { EvidenceState } from "@/components/EvidenceState";

export default function Loading(): ReactNode {
  return (
    <main className={`page-shell ${styles.root}`} aria-busy="true">
      <div className={`shell-container ${styles.layout}`}>
        <div className={styles.loadingHeader}>
          <EvidenceState state="loading" title="Cargando fiscalización" titleId="fiscalizacion-loading-heading">
            <p>Cargando el espacio de fiscalización</p>
          </EvidenceState>
        </div>
        <div className={styles.loadingFilters} aria-hidden="true" />
        <div className={styles.loadingEvidence} aria-hidden="true" />
      </div>
    </main>
  );
}
