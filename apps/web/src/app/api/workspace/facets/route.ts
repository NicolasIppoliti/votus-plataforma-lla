import { createSupabaseServerClient } from "../../../../lib/supabase/server-client";
import { authorizedOfficialFacets } from "../../../../lib/workspace/context";

const PRIVATE_HEADERS = { "cache-control": "private, no-store, max-age=0" };

export async function GET(): Promise<Response> {
  try {
    const payload = await authorizedOfficialFacets(await createSupabaseServerClient());
    return Response.json(payload, { headers: PRIVATE_HEADERS });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 403, headers: PRIVATE_HEADERS });
  }
}
