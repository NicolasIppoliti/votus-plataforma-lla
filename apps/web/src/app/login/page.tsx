import type { ReactNode } from "react";
import { LoginForm } from "./login-form";

/**
 * The one public route this app exposes (task 9.5/9.6). Deliberately
 * outside `(authenticated)/`, deliberately carries no electoral data.
 */
export default function LoginPage(): ReactNode {
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>Iniciar sesión</h1>
      <LoginForm />
    </main>
  );
}
