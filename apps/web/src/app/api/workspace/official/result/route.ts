import { createSupabaseServerClient } from "../../../../../lib/supabase/server-client";
import { authorizedOfficialResult } from "../../../../../lib/workspace/context";
import { parseResultRequest } from "../input";

const PRIVATE_HEADERS = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request): Promise<Response> {
  try {
    const selection = parseResultRequest(request);
    const payload = await authorizedOfficialResult(await createSupabaseServerClient(), selection);
    return Response.json(payload, { headers: PRIVATE_HEADERS });
  } catch (error) {
    const invalid = error instanceof Error && error.message === "invalid request";
    return Response.json({ status: invalid ? "invalid_request" : "unavailable" }, { status: invalid ? 400 : 403, headers: PRIVATE_HEADERS });
  }
}
