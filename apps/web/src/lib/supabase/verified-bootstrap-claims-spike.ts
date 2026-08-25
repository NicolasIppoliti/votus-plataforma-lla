const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface VerifiedBootstrapClaims {
  userId: string;
  sessionId: string;
  expiresAt: number;
}

interface AuthResponse {
  data: unknown;
  error: unknown;
}

export interface BootstrapClaimsAuth {
  getUser(token: string): Promise<AuthResponse>;
  getClaims(token: string): Promise<AuthResponse>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Spike-only server seam: the caller obtains the request token privately, then
 * makes Supabase verify it. This never decodes a JWT or reads a session.
 */
export async function verifyBootstrapClaims(
  auth: BootstrapClaimsAuth,
  accessToken: string,
): Promise<VerifiedBootstrapClaims> {
  const userResult = await auth.getUser(accessToken);
  const user = record(record(userResult.data)?.["user"]);
  const userId = user?.["id"];
  if (userResult.error || typeof userId !== "string" || !CANONICAL_UUID.test(userId)) {
    throw new Error("verified bootstrap identity unavailable");
  }

  const claimsResult = await auth.getClaims(accessToken);
  const claims = record(record(claimsResult.data)?.["claims"]);
  const sessionId = claims?.["session_id"];
  const expiresAt = claims?.["exp"];
  if (
    claimsResult.error ||
    claims?.["sub"] !== userId ||
    typeof sessionId !== "string" ||
    !CANONICAL_UUID.test(sessionId) ||
    typeof expiresAt !== "number" ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Math.floor(Date.now() / 1_000)
  ) {
    throw new Error("verified bootstrap claims unavailable");
  }
  return { userId, sessionId, expiresAt };
}
