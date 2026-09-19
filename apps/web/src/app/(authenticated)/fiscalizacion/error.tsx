"use client";

import type { ReactNode } from "react";
import { EvidenceState } from "@/components/EvidenceState";
import { Button } from "@/components/ui/button";

interface FiscalizacionErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ reset }: FiscalizacionErrorProps): ReactNode {
  return (
    <main className="page-shell fiscalizacion-workspace">
      <div className="shell-container fiscalizacion-workspace__layout">
        <EvidenceState state="error" title="No se pudo abrir fiscalización" titleId="fiscalizacion-error-heading">
          <p>Revise la conexión y vuelva a cargar este espacio. No se muestran datos de evidencia.</p>
          <Button variant="solid" type="button" onClick={reset}>Reintentar carga</Button>
        </EvidenceState>
      </div>
    </main>
  );
}
