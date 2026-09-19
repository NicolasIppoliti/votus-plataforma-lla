import type { ReactNode } from "react";
import { EvidenceState } from "@/components/EvidenceState";

export default function Loading(): ReactNode {
  return (
    <main className="page-shell fiscalizacion-workspace" aria-busy="true">
      <div className="shell-container fiscalizacion-workspace__layout">
        <div className="fiscalizacion-loading__header">
          <EvidenceState state="loading" title="Cargando fiscalización" titleId="fiscalizacion-loading-heading">
            <p>Cargando el espacio de fiscalización</p>
          </EvidenceState>
        </div>
        <div className="fiscalizacion-loading__filters" />
        <div className="fiscalizacion-loading__block" />
      </div>
    </main>
  );
}
