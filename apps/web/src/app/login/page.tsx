import type { ReactNode } from "react";
import { LoginForm } from "./login-form";

/**
 * The one public route this app exposes (task 9.5/9.6). Deliberately
 * outside `(authenticated)/`, deliberately carries no electoral data.
 */
export default function LoginPage(): ReactNode {
  return (
    <main id="main-content" className="login-page" tabIndex={-1}>
      <section className="panel login-card" aria-labelledby="login-heading">
        <header className="login-card__header">
          <h1 id="login-heading">Iniciar sesión</h1>
          <p className="panel__copy">
            Accede con tus credenciales para continuar.
          </p>
        </header>
        <LoginForm />
      </section>
    </main>
  );
}
