"use server";
import { redirect } from "next/navigation";
import { returnDestination } from "@/lib/auth/return-destination";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { selectWorkspace } from "@/lib/workspace/selection";

export async function chooseOrganization(form: FormData): Promise<never> {
  const destination = returnDestination(form.get("returnTo"));
  const id = form.get("organizationId");
  const revision = Number(form.get("revision"));
  let active = false;
  if (typeof id === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id) && Number.isSafeInteger(revision) && revision > 0) {
    active = (await selectWorkspace(id, revision)).status === "active";
  }
  redirect(`/onboarding?${new URLSearchParams({ paso: active ? "alcance" : "organizacion", returnTo: destination, ...(active ? {} : { error: "organizacion" }) })}`);
}

export async function finishOnboarding(form: FormData): Promise<never> {
  const destination = returnDestination(form.get("returnTo"));
  let completed = false;
  try {
    // The no-argument RPC derives identity and organization from verified DB claims.
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("workspace_api").rpc("complete_onboarding");
    completed = !error && data?.status === "ok";
  } catch { /* Surface a retry without disclosing database or session details. */ }
  if (completed) redirect(destination);
  redirect(`/onboarding?${new URLSearchParams({ paso: "ingreso", error: "finalizacion", returnTo: destination })}`);
}
