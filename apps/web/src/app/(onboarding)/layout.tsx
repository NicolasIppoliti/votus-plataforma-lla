import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import SessionMonitor from "@/components/SessionMonitor";
import { SignOutForm } from "@/components/SignOutForm";

/** Session-gated, intentionally outside the layout requiring completed onboarding. */
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");
  return <div className="shell-container app-content" id="main-content" tabIndex={-1}>
    <header><SignOutForm /></header>
    <SessionMonitor />
    {children}
    <footer className="source-disclaimer"><p role="note">Entorno de análisis: verificá las cifras contra las fuentes oficiales antes de tomar decisiones.</p></footer>
  </div>;
}
