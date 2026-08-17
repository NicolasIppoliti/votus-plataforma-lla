"use client";

import { useActionState, type ReactNode } from "react";
import { signIn } from "@/app/actions/sign-in";
import { INITIAL_SIGN_IN_STATE } from "@/app/actions/sign-in-state";

/**
 * Password sign-in form for the single authenticated role this change
 * supports (specs/access-control/spec.md). Authentication is owned by the
 * server action so the browser never receives a Supabase auth client.
 */
export function LoginForm(): ReactNode {
  const [state, formAction, isPending] = useActionState(
    signIn,
    INITIAL_SIGN_IN_STATE,
  );

  return (
    <form action={formAction} aria-busy={isPending}>
      <label htmlFor="email">Correo electrónico</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        aria-describedby={state.error === null ? undefined : "login-error"}
      />
      <label htmlFor="password">Contraseña</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        aria-describedby={state.error === null ? undefined : "login-error"}
      />
      <button type="submit" disabled={isPending}>
        {isPending ? "Iniciando sesión…" : "Iniciar sesión"}
      </button>
      {state.error === null ? null : (
        <p id="login-error" role="alert" aria-live="assertive">
          {state.error}
        </p>
      )}
    </form>
  );
}
