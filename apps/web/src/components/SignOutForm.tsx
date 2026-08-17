import type { ReactNode } from "react";
import { signOut } from "@/app/actions/sign-out";

export function SignOutForm(): ReactNode {
  return (
    <form action={signOut}>
      <button className="button button--secondary" type="submit">
        Cerrar sesión
      </button>
    </form>
  );
}
