import type { ReactNode } from "react";

export default function Loading(): ReactNode {
  return (
    <main className="page-shell fiscalizacion-workspace" aria-busy="true">
      <div className="shell-container fiscalizacion-workspace__layout" aria-label="Cargando fiscalización" role="status">
        <div className="fiscalizacion-loading__header" />
        <div className="fiscalizacion-loading__filters" />
        <div className="fiscalizacion-loading__block" />
      </div>
      <span className="sr-only">Cargando el espacio de fiscalización</span>
    </main>
  );
}
