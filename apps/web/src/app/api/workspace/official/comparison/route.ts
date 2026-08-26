import { createSupabaseServerClient } from "../../../../../lib/supabase/server-client";
import { authorizedOfficialComparison } from "../../../../../lib/workspace/context";
import { parseComparisonRequest } from "../input";

const PRIVATE_HEADERS = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request): Promise<Response> {
  try {
    const [left, right] = parseComparisonRequest(request);
    const payload = await authorizedOfficialComparison(await createSupabaseServerClient(), left, right);
    return Response.json(payload, { headers: PRIVATE_HEADERS });
  } catch (error) {
    const invalid = error instanceof Error && error.message === "invalid request";
    return Response.json({ status: invalid ? "invalid_request" : "unavailable" }, { status: invalid ? 400 : 403, headers: PRIVATE_HEADERS });
  }
}
