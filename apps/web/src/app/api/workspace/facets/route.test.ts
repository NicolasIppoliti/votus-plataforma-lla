import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), getClaims: vi.fn(), rpc: vi.fn(), schema: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../../../../lib/supabase/server-client", () => ({ createSupabaseServerClient: mocks.createClient }));
const { GET } = await import("./route");

beforeEach(() => {
  mocks.getClaims.mockReset().mockResolvedValue({ data: { claims: {
    sub: "10000000-0000-0000-0000-000000000001",
    session_id: "20000000-0000-0000-0000-000000000001",
    exp: Math.floor(Date.now() / 1_000) + 300,
  } }, error: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: { status: "ok", facets: [], total: 0, truncated: false }, error: null });
  mocks.schema.mockReset().mockReturnValue({ rpc: mocks.rpc });
  mocks.createClient.mockReset().mockResolvedValue({ auth: { getClaims: mocks.getClaims }, schema: mocks.schema });
});

describe("workspace facets GET", () => {
  it("uses the verified request client and claims-bound PostgREST RPC without caller authority arguments", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(mocks.schema).toHaveBeenCalledWith("workspace_api");
    expect(mocks.rpc).toHaveBeenCalledWith("official_facets");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({ status: "ok", facets: [], total: 0, truncated: false });
  });

  it("returns a bounded private error without leaking PostgREST details", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "secret relation details" } });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
