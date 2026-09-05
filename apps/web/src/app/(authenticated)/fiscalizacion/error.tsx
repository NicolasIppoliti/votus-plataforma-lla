"use client";

import type { ReactNode } from "react";

interface FiscalizacionErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ reset }: FiscalizacionErrorProps): ReactNode {
  return (
    <main className="page-shell fiscalizacion-workspace">
      <div className="shell-container fiscalizacion-workspace__layout">
        <section className="fiscalizacion-workspace__state" role="alert" aria-labelledby="fiscalizacion-error-heading">
          <h1 id="fiscalizacion-error-heading">No se pudo abrir fiscalización</h1>
          <p>Revise la conexión y vuelva a cargar este espacio. No se muestran datos de evidencia.</p>
          <button className="button button--primary" type="button" onClick={reset}>Reintentar carga</button>
        </section>
      </div>
    </main>
  );
}
