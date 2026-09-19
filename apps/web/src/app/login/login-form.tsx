"use client";

import { useActionState, type ReactNode } from "react";
import { signIn } from "@/app/actions/sign-in";
import { INITIAL_SIGN_IN_STATE } from "@/app/actions/sign-in-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <form
      aria-labelledby="login-heading"
      className="login-form"
      aria-busy={isPending || undefined}
    >
      <div className="field">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          aria-describedby="login-error"
          aria-invalid={state.error !== null}
          required
        />
      </div>
      <div className="field">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-describedby="login-error"
          aria-invalid={state.error !== null}
          required
        />
      </div>
      <Button
        variant="solid"
        className="min-h-12 w-full min-w-0"
        type="submit"
        formAction={formAction}
        disabled={isPending}
      >
        {isPending ? "Iniciando sesión…" : "Iniciar sesión"}
      </Button>
      <p
        id="login-error"
        className="login-form__feedback"
        role="alert"
        aria-live="assertive"
      >
        {state.error}
      </p>
    </form>
  );
}
