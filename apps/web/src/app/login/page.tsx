import type { ReactNode } from "react";
import { LoginForm } from "./login-form";
import { returnDestination } from "@/lib/auth/return-destination";
import "./login.css";

/**
 * The one public route this app exposes (task 9.5/9.6). Deliberately
 * outside `(authenticated)/`, deliberately carries no electoral data.
 */
export default async function LoginPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const destination = returnDestination((await searchParams)["returnTo"]);
  return (
    <main id="main-content" className="login-page" tabIndex={-1}>
      <header className="login-brand" aria-label="Acceso a Votus">
        <span className="login-brand__name" aria-label="votus."><svg viewBox="0 0 42 42" aria-hidden="true"><path d="M6 7 21 35 36 7M14 7l7 14 7-14" /></svg>votus<span className="login-brand__dot">.</span></span>
        <p className="login-brand__purpose">Análisis electoral, con evidencia.</p>
        <p className="login-brand__description">
          Resultados oficiales, comparación de elecciones y escenarios en un mismo espacio de trabajo.
        </p>
      </header>
      <section className="panel login-card" aria-labelledby="login-heading">
        <header className="login-card__header">
          <h1 id="login-heading">Iniciar sesión</h1>
          <p className="panel__copy">
            Accede con tus credenciales para continuar.
          </p>
        </header>
        <LoginForm returnTo={destination} />
        <p className="login-card__access">Acceso exclusivo para usuarios autorizados.</p>
      </section>
    </main>
  );
}
