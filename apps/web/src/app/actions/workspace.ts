"use server";
import { createSupabaseServerClient } from "../../lib/supabase/server-client";
import { observeWorkspace, switchWorkspaceContext } from "../../lib/workspace/context";
export async function loadWorkspace() { return observeWorkspace(await createSupabaseServerClient()); }
export async function switchWorkspace(organizationId: string, expectedRevision: number) {
  const client = await createSupabaseServerClient();
  return switchWorkspaceContext(client, organizationId, expectedRevision);
}
