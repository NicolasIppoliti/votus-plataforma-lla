import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn(), schema: vi.fn() }));
vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({ auth: { getClaims: mocks.getClaims }, schema: mocks.schema }),
}));
import { GET } from "./route";

const claims = {
  sub: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  session_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12",
  exp: 4_102_444_800,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getClaims.mockResolvedValue({ data: { claims }, error: null });
  mocks.schema.mockReturnValue({ rpc: mocks.rpc });
});

describe("private session lifecycle route", () => {
  it("returns only current status without bootstrapping context or listing organizations", async () => {
    mocks.rpc.mockResolvedValue({ data: {
      status: "active", context_revision: 3,
      organization: { id: "private-organization", display_name: "Private organization" },
    }, error: null });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({ status: "active" });
    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(mocks.schema).toHaveBeenCalledWith("workspace_api");
    expect(mocks.rpc.mock.calls).toEqual([["current_workspace"]]);
  });

  it.each(["expired", "revoked", "stale", "selection_required"])("keeps %s distinct without exposing context details", async (status) => {
    mocks.rpc.mockResolvedValue({ data: { status, context_revision: 2, private_details: "not public" }, error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status });
  });

  it.each([null, [], {}, { status: "unknown", context_revision: 1 }, { status: "expired", context_revision: -1 }, { status: "revoked", context_revision: "1" }])("treats malformed evidence as unavailable, never expired: %j", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });

  it("preserves a context mismatch without reporting authentication loss", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "VOT03", message: "private mismatch" } });
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "mismatch" });
  });

  it("does not query workspace state without verified canonical session claims", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { ...claims, session_id: "invalid" } }, error: null });
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
    expect(mocks.schema).not.toHaveBeenCalled();
  });

  it("contains thrown authentication failures and database errors without details", async () => {
    mocks.getClaims.mockRejectedValueOnce(new Error("private authentication details"));
    expect((await GET()).status).toBe(503);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "private connection details" } });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
