import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { observeCurrentWorkspace, workspaceContextErrorCategory } from "@/lib/workspace/context";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store, max-age=0" };
const currentStatuses = new Set(["active", "selection_required", "stale", "expired", "revoked"]);
const json = (status: string, httpStatus = 200) => Response.json({ status }, { status: httpStatus, headers });

export async function GET(): Promise<Response> {
  try {
    const current = await observeCurrentWorkspace(await createSupabaseServerClient());
    if (typeof current !== "object" || current === null || Array.isArray(current)) return json("unavailable", 503);
    const { status, context_revision: revision } = current as Record<string, unknown>;
    if (typeof status !== "string" || !currentStatuses.has(status) || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) return json("unavailable", 503);
    return json(status);
  } catch (error) {
    if (workspaceContextErrorCategory(error) === "mismatch") return json("mismatch");
    return json("unavailable", 503);
  }
}
