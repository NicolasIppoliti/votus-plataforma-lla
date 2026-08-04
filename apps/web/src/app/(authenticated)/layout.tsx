import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";

/**
 * Layout gate for every in-scope route (task 9.6).
 *
 * Single authenticated role: this checks only "is there a valid session" —
 * no role, privilege flag, or user attribute is read here, so every
 * authenticated user renders through the exact same path
 * (specs/access-control/spec.md, "Single authenticated role"). Any route
 * placed under `src/app/(authenticated)/` inherits this gate automatically;
 * `middleware.ts` already denies unauthenticated requests earlier in the
 * pipeline, so this is a second, independent check at render time.
 */
export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <>{children}</>;
}
