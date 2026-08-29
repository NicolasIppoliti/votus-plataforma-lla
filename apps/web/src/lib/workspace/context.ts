import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExplorationFacetSelection } from "@/lib/results/exploration";
import type { OfficialSectionSelection, OfficialSelection } from "../../app/api/workspace/official/input";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const WORKSPACE_CONTEXT_ERROR_CATEGORY = {
  MISMATCH: "mismatch",
} as const;

type WorkspaceContextErrorCategory =
  (typeof WORKSPACE_CONTEXT_ERROR_CATEGORY)[keyof typeof WORKSPACE_CONTEXT_ERROR_CATEGORY];

class WorkspaceContextError extends Error {
  readonly category: WorkspaceContextErrorCategory;

  constructor(category: WorkspaceContextErrorCategory) {
    super("Workspace operation failed");
    this.name = "WorkspaceContextError";
    this.category = category;
  }
}

export function workspaceContextErrorCategory(error: unknown): WorkspaceContextErrorCategory | null {
  return error instanceof WorkspaceContextError ? error.category : null;
}

interface FiscalizacionCoverageEvidence {
  status: "ok" | "denominator_unavailable" | "selection_invalid" | "source_unavailable";
  authorization_status: "authorized";
  source_kind: "fiscalizacion";
  is_random_sample: false;
  vote_data: "not_included";
  observed_units: number;
  denominator_units: number;
  uncovered: { items: unknown[]; total: number; truncated: boolean };
  exclusions: { items: unknown[]; total: number; truncated: boolean };
  truncated: boolean;
}

interface FiscalizacionEvidenceExclusion { reason: string; rows: number }
interface FiscalizacionEvidenceCollection<T> { items: T[]; total: number; truncated: boolean }

export type AuthorizedFiscalizacionCoverage = FiscalizacionCoverageEvidence
  | { status: "opt_in_required" }
  | { status: "source_inconsistent"; exclusions: FiscalizacionEvidenceCollection<FiscalizacionEvidenceExclusion> }
  | { status: "authorization_denied"; authorization_status: string | null }
  | { status: "payload_too_large"; authorization_status: "authorized"; source_kind: "fiscalizacion"; is_random_sample: false; vote_data: "not_included"; truncated: true };

export const FISCAL_RESULT_STATUS = { OK: "ok", NO_ROWS: "no_rows", OPT_IN_REQUIRED: "opt_in_required", SOURCE_INCONSISTENT: "source_inconsistent", AUTHORIZATION_DENIED: "authorization_denied", PAYLOAD_TOO_LARGE: "payload_too_large" } as const;
interface FiscalResultReference { election_year: number | null; election_round: string | null; category_name: string | null; distrito_code: string; seccion_code: string; denominator_units: number }
interface FiscalResultRow { list_id: string | null; canonical_party_id: string | null; party_name: string | null; granularity: string; votes: number; rows: number }
interface FiscalResultUnmapped { list_id: string | null; votes: number; rows: number }
interface FiscalResultProvenance { id: string; sha256: string | null; fetched_at: string; status: string }
type FiscalResultCollection<T> = FiscalizacionEvidenceCollection<T>;
interface FiscalResultEvidence { status: typeof FISCAL_RESULT_STATUS.OK | typeof FISCAL_RESULT_STATUS.NO_ROWS; authorization_status: "authorized"; source_kind: "fiscalizacion"; is_random_sample: false; reference: FiscalResultReference; rows: FiscalResultCollection<FiscalResultRow>; unmapped: FiscalResultCollection<FiscalResultUnmapped>; exclusions: FiscalResultCollection<FiscalizacionEvidenceExclusion>; provenance: FiscalResultCollection<FiscalResultProvenance>; truncated: boolean }
export type AuthorizedFiscalizacionResult = FiscalResultEvidence
  | { status: typeof FISCAL_RESULT_STATUS.OPT_IN_REQUIRED }
  | { status: typeof FISCAL_RESULT_STATUS.SOURCE_INCONSISTENT; exclusions: FiscalResultCollection<FiscalizacionEvidenceExclusion> }
  | { status: typeof FISCAL_RESULT_STATUS.AUTHORIZATION_DENIED; authorization_status: string | null }
  | { status: typeof FISCAL_RESULT_STATUS.PAYLOAD_TOO_LARGE; authorization_status: "authorized"; source_kind: "fiscalizacion"; is_random_sample: false; truncated: true };

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
  parameters?: Record<string, boolean | number | string | null>,
) {
  const { data, error } = parameters
    ? await api.rpc(name, parameters)
    : await api.rpc(name);
  if (error?.code === "VOT03") {
    throw new WorkspaceContextError(WORKSPACE_CONTEXT_ERROR_CATEGORY.MISMATCH);
  }
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

export async function authorizedOfficialFacets(client: SupabaseClient, selection: ExplorationFacetSelection = {}) {
  return rpcData(await verifiedWorkspaceApi(client), "official_facets", {
    p_election_id: selection.electionId ?? null,
    p_category_id: selection.categoryId ?? null,
    p_distrito_code: selection.distritoCode ?? null,
    p_seccion_code: selection.seccionCode ?? null,
    p_circuito_code: selection.circuitoCode ?? null,
    p_establecimiento_code: selection.establecimientoCode ?? null,
  });
}

export async function authorizedFiscalizacionCoverage(
  client: SupabaseClient,
  selection: OfficialSectionSelection,
  optIn: boolean,
): Promise<AuthorizedFiscalizacionCoverage> {
  return rpcData(await verifiedWorkspaceApi(client), "fiscalizacion_coverage", {
    ...officialSectionParameters(selection),
    p_opt_in: optIn,
  }) as Promise<AuthorizedFiscalizacionCoverage>;
}

export async function authorizedFiscalizacionResult(client: SupabaseClient, selection: OfficialSectionSelection, optIn: boolean): Promise<AuthorizedFiscalizacionResult> {
  return rpcData(await verifiedWorkspaceApi(client), "fiscalizacion_result", { ...officialSectionParameters(selection), p_opt_in: optIn }) as Promise<AuthorizedFiscalizacionResult>;
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

function comparisonParameters(left: OfficialSelection, right: OfficialSelection) {
  return Object.fromEntries([
    ...Object.entries(officialParameters(left)).map(([key, value]) => [key.replace("p_", "p_left_"), value]),
    ...Object.entries(officialParameters(right)).map(([key, value]) => [key.replace("p_", "p_right_"), value]),
  ]);
}

export async function authorizedOfficialComparison(client: SupabaseClient, left: OfficialSelection, right: OfficialSelection) {
  return rpcData(await verifiedWorkspaceApi(client), "official_comparison", comparisonParameters(left, right));
}

export async function authorizedOfficialComparisonBundle(
  client: SupabaseClient,
  left: OfficialSelection,
  right: OfficialSelection,
) {
  if (!left.seccionCode || !right.seccionCode) throw new Error("Invalid workspace selection");
  const api = await verifiedWorkspaceApi(client);
  const leftSection = officialSectionParameters({ ...left, seccionCode: left.seccionCode });
  const rightSection = officialSectionParameters({ ...right, seccionCode: right.seccionCode });
  const [comparison, leftReference, rightReference, leftProvenance, rightProvenance] = await Promise.all([
    rpcData(api, "official_comparison", comparisonParameters(left, right)),
    rpcData(api, "official_reference", leftSection),
    rpcData(api, "official_reference", rightSection),
    rpcData(api, "official_provenance", leftSection),
    rpcData(api, "official_provenance", rightSection),
  ]);
  return { comparison, leftReference, rightReference, leftProvenance, rightProvenance };
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
