export const metadata = { title: "Página no encontrada" };

import Link from "next/link";
import type { ReactNode } from "react";

/** Unknown routes (#600). */
export default function NotFound(): ReactNode {
  return (
    <main className="page-shell" id="main-content" tabIndex={-1}>
      <div className="shell-container">
        <h1>Página no encontrada</h1>
        <p>La dirección no corresponde a ninguna sección de Votus.</p>
        <p><Link href="/">Volver al inicio</Link></p>
      </div>
    </main>
  );
}
