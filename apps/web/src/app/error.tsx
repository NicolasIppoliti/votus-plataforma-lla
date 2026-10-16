"use client";

import type { ReactNode } from "react";
import { EvidenceState } from "@/components/EvidenceState";
import { Button } from "@/components/ui/button";

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Wraps the authenticated layout (#600). Never render the error message or
 * digest: they can carry internal identifiers. */
export default function AppError({ reset }: AppErrorProps): ReactNode {
  return (
    <main className="page-shell" id="main-content" tabIndex={-1}>
      <div className="shell-container">
        <EvidenceState state="error" title="No se pudo abrir el espacio de trabajo" titleId="app-error-heading">
          <p>Ocurrió un problema al cargar la sesión o la organización. No se muestran datos.</p>
          <p><Button variant="solid" type="button" onClick={reset}>Reintentar</Button> <a href="/login">Volver a iniciar sesión</a></p>
        </EvidenceState>
      </div>
    </main>
  );
}
