import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { observeWorkspace, switchWorkspaceContext, WORKSPACE_CONTEXT_ERROR_CATEGORY, workspaceContextErrorCategory } from "@/lib/workspace/context";
export const WORKSPACE_SELECTION_STATUS = {
  ACTIVE: "active", CONFLICT: "conflict", DENIED: "denied", EXPIRED: "expired", MISMATCH: "mismatch",
  REQUIRED: "selection_required", REVOKED: "revoked", STALE: "stale", UNAVAILABLE: "unavailable",
} as const;
export type WorkspaceSelectionStatus = (typeof WORKSPACE_SELECTION_STATUS)[keyof typeof WORKSPACE_SELECTION_STATUS];
export interface WorkspaceOption { id: string; name: string; }
export interface WorkspaceSelection {
  status: WorkspaceSelectionStatus; revision: number | null; activeOrganizationId: string | null;
  organizations: WorkspaceOption[]; total: number | null; truncated: boolean | null;
}
interface AvailableOrganizations { organizations: WorkspaceOption[]; total: number; truncated: boolean; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const object = (value: unknown): Record<string, unknown> | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const revision = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const nonnegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function projection(status: WorkspaceSelectionStatus, contextRevision: number | null = null, available?: AvailableOrganizations, activeOrganizationId: string | null = null, organizations = available?.organizations ?? []): WorkspaceSelection {
  return { status, revision: contextRevision, activeOrganizationId, organizations, total: available?.total ?? null, truncated: available?.truncated ?? null };
}
const unavailable = (): WorkspaceSelection => projection(WORKSPACE_SELECTION_STATUS.UNAVAILABLE);
const mismatch = (error: unknown): WorkspaceSelection | null => workspaceContextErrorCategory(error) === WORKSPACE_CONTEXT_ERROR_CATEGORY.MISMATCH ? projection(WORKSPACE_SELECTION_STATUS.MISMATCH) : null;

function option(value: unknown): WorkspaceOption | null {
  const item = object(value);
  return item && typeof item["id"] === "string" && UUID.test(item["id"]) && typeof item["display_name"] === "string" && item["display_name"].trim().length > 0
    ? { id: item["id"], name: item["display_name"] } : null;
}

function availableOrganizations(value: unknown): AvailableOrganizations | null {
  const available = object(value); const rows = available?.["organizations"]; const total = available?.["total"]; const truncated = available?.["truncated"];
  if (available?.["status"] !== "ok" || !Array.isArray(rows) || rows.length > 100 || !nonnegativeInteger(total) || typeof truncated !== "boolean" || truncated !== (total > 100) || total < rows.length || (!truncated && total !== rows.length)) return null;
  const organizations: WorkspaceOption[] = []; const identifiers = new Set<string>();
  for (const row of rows) {
    const parsed = option(row);
    if (!parsed || identifiers.has(parsed.id)) return null;
    identifiers.add(parsed.id); organizations.push(parsed);
  }
  return { organizations, total, truncated };
}

export async function loadWorkspaceSelection(): Promise<WorkspaceSelection> {
  try {
    const observed = await observeWorkspace(await createSupabaseServerClient());
    const available = availableOrganizations(observed.available); const current = object(observed.current);
    if (!available || !current) return unavailable();
    const contextRevision = revision(current["context_revision"]);
    if (contextRevision === null) return unavailable();
    if (current["status"] === "selection_required") return projection(WORKSPACE_SELECTION_STATUS.REQUIRED, contextRevision, available);
    if (current["status"] === "stale") return projection(WORKSPACE_SELECTION_STATUS.STALE, contextRevision, available);
    if (current["status"] === "revoked") return projection(WORKSPACE_SELECTION_STATUS.REVOKED, contextRevision, available);
    if (current["status"] === "expired") return projection(WORKSPACE_SELECTION_STATUS.EXPIRED, contextRevision, available);
    if (current["status"] !== "active") return unavailable();
    const active = option(current["organization"]);
    if (!active) return unavailable();
    const returned = available.organizations.find((organization) => organization.id === active.id);
    if (returned) return returned.name === active.name ? projection(WORKSPACE_SELECTION_STATUS.ACTIVE, contextRevision, available, active.id) : unavailable();
    return available.truncated ? projection(WORKSPACE_SELECTION_STATUS.ACTIVE, contextRevision, available, active.id, [...available.organizations, active]) : unavailable();
  } catch (error) { return mismatch(error) ?? unavailable(); }
}

export async function selectWorkspace(organizationId: string, expectedRevision: number): Promise<WorkspaceSelection> {
  try {
    const result = object(await switchWorkspaceContext(await createSupabaseServerClient(), organizationId, expectedRevision));
    const contextRevision = revision(result?.["context_revision"]);
    if (!result || contextRevision === null) return unavailable();
    const status = result["status"];
    if (status === "active" || status === "same_state") return projection(WORKSPACE_SELECTION_STATUS.ACTIVE, contextRevision, undefined, organizationId);
    if (status === "selection_required") return projection(WORKSPACE_SELECTION_STATUS.REQUIRED, contextRevision);
    if (status === "conflict") return projection(WORKSPACE_SELECTION_STATUS.CONFLICT, contextRevision);
    if (status === "denied") return projection(WORKSPACE_SELECTION_STATUS.DENIED, contextRevision);
    if (status === "stale") return projection(WORKSPACE_SELECTION_STATUS.STALE, contextRevision);
    if (status === "revoked") return projection(WORKSPACE_SELECTION_STATUS.REVOKED, contextRevision);
    if (status === "expired") return projection(WORKSPACE_SELECTION_STATUS.EXPIRED, contextRevision);
    return unavailable();
  } catch (error) { return mismatch(error) ?? unavailable(); }
}
