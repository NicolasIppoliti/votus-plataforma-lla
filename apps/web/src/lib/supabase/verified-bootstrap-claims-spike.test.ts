import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyBootstrapClaims } from "./verified-bootstrap-claims-spike";

const require = createRequire(import.meta.url);
const UUID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const TOKEN = "real-request-token";

function client(overrides: Record<string, unknown> = {}) {
  return {
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: UUID } }, error: null }),
    getClaims: vi.fn().mockResolvedValue({
      data: { claims: { sub: UUID, session_id: UUID, exp: 4_102_444_800 } },
      error: null,
    }),
    ...overrides,
  };
}

describe("verifyBootstrapClaims", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("records the exact installed Supabase packages", () => {
    expect(require("@supabase/ssr/package.json").version).toBe("0.12.4");
    expect(require("@supabase/supabase-js/package.json").version).toBe("2.112.0");
  });

  it("gets the user before cryptographically verifying the supplied token", async () => {
    const auth = client();
    await expect(verifyBootstrapClaims(auth, TOKEN)).resolves.toEqual({
      userId: UUID,
      sessionId: UUID,
      expiresAt: 4_102_444_800,
    });
    expect(auth.getUser).toHaveBeenCalledWith(TOKEN);
    expect(auth.getClaims).toHaveBeenCalledWith(TOKEN);
    expect(auth.getUser.mock.invocationCallOrder[0]).toBeLessThan(
      auth.getClaims.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    ["unavailable verifier", client({ getClaims: vi.fn().mockResolvedValue({ data: null, error: Error("unavailable") }) })],
    ["wrong subject", client({ getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "other", session_id: UUID, exp: 4_102_444_800 } }, error: null }) })],
    ["noncanonical session", client({ getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: UUID, session_id: UUID.toUpperCase(), exp: 4_102_444_800 } }, error: null }) })],
    ["malformed expiry", client({ getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: UUID, session_id: UUID, exp: "soon" } }, error: null }) })],
    ["expired token", client({ getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: UUID, session_id: UUID, exp: 1 } }, error: null }) })],
  ])("denies %s before bootstrap dispatch", async (_name, auth) => {
    await expect(verifyBootstrapClaims(auth, TOKEN)).rejects.toThrow("verified");
  });
});
