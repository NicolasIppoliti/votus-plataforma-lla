import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function hasStrictSessionClaims(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const claims = value as Record<string, unknown>;
  return (
    typeof claims["sub"] === "string" &&
    CANONICAL_UUID.test(claims["sub"]) &&
    typeof claims["session_id"] === "string" &&
    CANONICAL_UUID.test(claims["session_id"]) &&
    typeof claims["exp"] === "number" &&
    Number.isSafeInteger(claims["exp"]) &&
    claims["exp"] > Math.floor(Date.now() / 1_000)
  );
}

async function verifiedWorkspaceApi(client: SupabaseClient) {
  const verified = await client.auth.getClaims();
  if (verified.error || !hasStrictSessionClaims(verified.data?.claims)) {
    throw new Error("Workspace authentication failed");
  }
  return client.schema("workspace_api");
}

async function rpcData(
  api: ReturnType<SupabaseClient["schema"]>,
  name: string,
  parameters?: Record<string, number | string>,
) {
  const { data, error } = parameters
    ? await api.rpc(name, parameters)
    : await api.rpc(name);
  if (error) throw new Error("Workspace operation failed");
  return data;
}

export async function observeWorkspace(client: SupabaseClient) {
  const api = await verifiedWorkspaceApi(client);
  const bootstrap = await rpcData(api, "bootstrap_workspace_context");
  const available = await rpcData(api, "available_organizations");
  const current = await rpcData(api, "current_workspace");
  return { bootstrap, available, current };
}

export async function switchWorkspaceContext(
  client: SupabaseClient,
  organizationId: string,
  expectedRevision: number,
) {
  if (!CANONICAL_UUID.test(organizationId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error("Invalid workspace selection");
  }
  const api = await verifiedWorkspaceApi(client);
  return rpcData(api, "switch_workspace_context", {
    p_expected_revision: expectedRevision,
    p_organization_id: organizationId,
  });
}

/** Called by app/actions/sign-out.ts before auth cookie removal; invalidates only the verified request session. */
export async function invalidateWorkspaceContext(client: SupabaseClient): Promise<boolean> {
  try {
    const api = await verifiedWorkspaceApi(client);
    const { error } = await api.rpc("invalidate_workspace_context");
    return error === null;
  } catch {
    return false;
  }
}
