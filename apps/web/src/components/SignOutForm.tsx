import type { ReactNode } from "react";
import { signOut } from "@/app/actions/sign-out";
import { Button } from "@/components/ui/button";

export function SignOutForm(): ReactNode {
  return (
    <form action={signOut}>
      <Button variant="outline" type="submit">
        Cerrar sesión
      </Button>
    </form>
  );
}
