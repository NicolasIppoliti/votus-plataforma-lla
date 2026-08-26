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

/** Invalidates only the verified request session before its auth cookie is removed. */
export async function invalidateWorkspaceContext(client: SupabaseClient): Promise<boolean> {
  const verified = await client.auth.getClaims();
  if (verified.error || !hasStrictSessionClaims(verified.data?.claims)) return false;

  const { error } = await client
    .schema("workspace_api")
    .rpc("invalidate_workspace_context");
  return error === null;
}
