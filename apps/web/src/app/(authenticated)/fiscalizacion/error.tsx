"use client";

import type { ReactNode } from "react";
import styles from "./fiscalizacion.module.css";
import { EvidenceState } from "@/components/EvidenceState";
import { Button } from "@/components/ui/button";

interface FiscalizacionErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ reset }: FiscalizacionErrorProps): ReactNode {
  return (
    <main className={`page-shell ${styles.root}`}>
      <div className={`shell-container ${styles.layout}`}>
        <EvidenceState state="error" title="No se pudo abrir fiscalización" titleId="fiscalizacion-error-heading">
          <p>Revise la conexión y vuelva a cargar este espacio. No se muestran datos de evidencia.</p>
          <Button variant="solid" type="button" onClick={reset}>Reintentar carga</Button>
        </EvidenceState>
      </div>
    </main>
  );
}
