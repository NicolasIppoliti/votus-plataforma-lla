"use client";

import type { ReactNode } from "react";
import "./globals.css";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Replaces the root layout when it fails (#600), so it renders its own
 * document. Never render the error message or digest. */
export default function GlobalError({ reset }: GlobalErrorProps): ReactNode {
  return (
    <html lang="es">
      <body>
        <main className="page-shell">
          <div className="shell-container">
            <h1>No se pudo cargar Votus</h1>
            <p>Ocurrió un problema inesperado. No se muestran datos.</p>
            <p><button type="button" onClick={reset}>Reintentar</button> <a href="/login">Volver a iniciar sesión</a></p>
          </div>
        </main>
      </body>
    </html>
  );
}
