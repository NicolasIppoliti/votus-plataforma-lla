import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OfficialSectionSelection, OfficialSelection } from "../../app/api/workspace/official/input";

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
  parameters?: Record<string, number | string | null>,
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

export async function authorizedOfficialFacets(client: SupabaseClient) {
  return rpcData(await verifiedWorkspaceApi(client), "official_facets");
}

export async function authorizedReviewItems(client: SupabaseClient, limit = 50, offset = 0) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 2_000_000_000) {
    throw new Error("Invalid review pagination");
  }
  return rpcData(await verifiedWorkspaceApi(client), "review_items", {
    p_limit: limit,
    p_offset: offset,
  });
}

function officialParameters(selection: OfficialSelection) {
  return {
    p_category_id: selection.categoryId,
    p_circuito_code: selection.circuitoCode,
    p_distrito_code: selection.distritoCode,
    p_election_id: selection.electionId,
    p_establecimiento_code: selection.establecimientoCode,
    p_mesa_code: selection.mesaCode,
    p_requested_level: selection.requestedLevel,
    p_seccion_code: selection.seccionCode,
  };
}

function officialSectionParameters(selection: OfficialSectionSelection) {
  return {
    p_category_id: selection.categoryId,
    p_distrito_code: selection.distritoCode,
    p_election_id: selection.electionId,
    p_seccion_code: selection.seccionCode,
  };
}

export async function authorizedOfficialBundle(client: SupabaseClient, selection: OfficialSelection) {
  if (!selection.seccionCode) throw new Error("Invalid workspace selection");
  const api = await verifiedWorkspaceApi(client);
  const section = officialSectionParameters({ ...selection, seccionCode: selection.seccionCode });
  const [result, schools, reference, provenance] = await Promise.all([
    rpcData(api, "official_result", officialParameters(selection)),
    rpcData(api, "official_schools", section),
    rpcData(api, "official_reference", section),
    rpcData(api, "official_provenance", section),
  ]);
  return { result, schools, reference, provenance };
}

export async function authorizedOfficialComparison(client: SupabaseClient, left: OfficialSelection, right: OfficialSelection) {
  const leftParameters = officialParameters(left);
  const rightParameters = officialParameters(right);
  return rpcData(await verifiedWorkspaceApi(client), "official_comparison", Object.fromEntries([
    ...Object.entries(leftParameters).map(([key, value]) => [key.replace("p_", "p_left_"), value]),
    ...Object.entries(rightParameters).map(([key, value]) => [key.replace("p_", "p_right_"), value]),
  ]));
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
