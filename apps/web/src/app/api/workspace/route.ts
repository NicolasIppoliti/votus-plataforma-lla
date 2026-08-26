import { loadWorkspace, switchWorkspace } from "../../actions/workspace";
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const invalidRequest = () => Response.json({ status: "invalid_request" }, { status: 400 });
export async function GET(): Promise<Response> { return Response.json(await loadWorkspace()); }
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return invalidRequest(); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return invalidRequest();
  const input = body as Record<string, unknown>;
  if (typeof input["organizationId"] !== "string" || !CANONICAL_UUID.test(input["organizationId"]) || typeof input["expectedRevision"] !== "number" || !Number.isSafeInteger(input["expectedRevision"]) || input["expectedRevision"] < 1) return invalidRequest();
  return Response.json(await switchWorkspace(input["organizationId"], input["expectedRevision"]));
}
