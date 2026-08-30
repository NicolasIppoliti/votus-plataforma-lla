import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getClaims: vi.fn(), rpc: vi.fn(), schema: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../../../../lib/supabase/server-client", () => ({ createSupabaseServerClient: mocks.createClient }));
const { GET } = await import("./route");

const side = (prefix: string, section: string) => `${prefix}election_id=50000000-0000-0000-0000-000000000001&${prefix}category_id=51000000-0000-0000-0000-000000000001&${prefix}distrito_code=02&${prefix}seccion_code=${section}&${prefix}requested_level=seccion`;
const URL = `http://localhost/api/workspace/official/comparison?${side("left_", "027")}&${side("right_", "028")}`;

beforeEach(() => {
  mocks.getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: "41000000-0000-0000-0000-000000000001", session_id: "42000000-0000-0000-0000-000000000001", exp: Math.floor(Date.now() / 1_000) + 300 } }, error: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: { status: "ok", left: { total_votes: 3 }, right: { total_votes: 4 } }, error: null });
  mocks.schema.mockReset().mockReturnValue({ rpc: mocks.rpc });
  mocks.createClient.mockReset().mockResolvedValue({ auth: { getClaims: mocks.getClaims }, schema: mocks.schema });
});

describe("workspace official comparison GET", () => {
  it("uses one verified client while keeping both selections independent", async () => {
    const response = await GET(new Request(URL));
    expect(response.status).toBe(200);
    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc.mock.calls[0]?.[0]).toBe("official_comparison");
    expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({ p_left_seccion_code: "027", p_right_seccion_code: "028" });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("returns a bounded private error without leaking RPC details", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private database details" } });
    const response = await GET(new Request(URL));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
