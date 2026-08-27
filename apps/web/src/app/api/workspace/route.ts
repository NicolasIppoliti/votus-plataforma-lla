import { loadWorkspaceSelection, selectWorkspace, type WorkspaceSelectionStatus } from "@/lib/workspace/selection";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const headers = { "Cache-Control": "private, no-store, max-age=0" };
const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers });
const GET_STATUS: Record<WorkspaceSelectionStatus, number> = { active: 200, conflict: 200, denied: 200, expired: 200, mismatch: 409, selection_required: 200, revoked: 200, stale: 200, unavailable: 503 };
const POST_STATUS: Record<WorkspaceSelectionStatus, number> = { active: 200, conflict: 409, denied: 403, expired: 409, mismatch: 409, selection_required: 409, revoked: 409, stale: 409, unavailable: 503 };

export async function GET(): Promise<Response> {
  const selection = await loadWorkspaceSelection();
  return json(selection, GET_STATUS[selection.status]);
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ status: "invalid_request" }, 400); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return json({ status: "invalid_request" }, 400);
  const input = body as Record<string, unknown>;
  if (typeof input["organizationId"] !== "string" || !UUID.test(input["organizationId"]) || typeof input["expectedRevision"] !== "number" || !Number.isSafeInteger(input["expectedRevision"]) || input["expectedRevision"] < 1) return json({ status: "invalid_request" }, 400);
  const result = await selectWorkspace(input["organizationId"], input["expectedRevision"]);
  return json(result, POST_STATUS[result.status]);
}
