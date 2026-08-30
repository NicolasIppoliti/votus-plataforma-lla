"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { invalidateWorkspaceContext } from "@/lib/workspace/context";

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!(await invalidateWorkspaceContext(supabase))) return;

  const { error } = await supabase.auth.signOut({ scope: "local" });

  if (error) return;

  redirect("/login");
}
