import type { ReactNode } from "react";
import Link from "next/link";
import { SignOutForm } from "@/components/SignOutForm";

export default function HomePage(): ReactNode {
  return (
    <main id="main-content" className="public-shell" tabIndex={-1}>
      <div className="shell-container">
        <header className="page-header">
          <SignOutForm />
          <p className="eyebrow">Análisis electoral interno</p>
          <h1>Votus</h1>
          <p className="page-header__lede">
            Un espacio de evidencia cívica para examinar resultados electorales,
            elementos pendientes de revisión y supuestos declarados sin convertir
            la incertidumbre en una afirmación.
          </p>
          <p className="page-header__supporting">
            Votus permite trabajar con evidencia oficial y pública, mantener
            visible la procedencia y distinguir un análisis preparado de uno
            pendiente mediante el estado explícito de la fuente.
          </p>
        </header>

        <section className="panel panel--quiet" aria-labelledby="workspace-heading">
          <div className="panel__heading">
            <p className="eyebrow">Espacio de trabajo</p>
            <h2 id="workspace-heading">Comience por el panel de análisis</h2>
            <p>
              Revise todos los flujos disponibles en un solo lugar. Los análisis
              que dependen del contexto se presentan de forma explícita, en lugar
              de ofrecerse como selectores sin información previa.
            </p>
          </div>
          <Link className="button button--primary" href="/dashboard">
            Abrir el panel
          </Link>
        </section>
      </div>
    </main>
  );
}
