import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getClaims: vi.fn(), rpc: vi.fn(), schema: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../../../../lib/supabase/server-client", () => ({ createSupabaseServerClient: mocks.createClient }));
const { GET } = await import("./route");

const URL = "http://localhost/api/workspace/official/result?election_id=50000000-0000-0000-0000-000000000001&category_id=51000000-0000-0000-0000-000000000001&distrito_code=02&seccion_code=027&requested_level=seccion";

beforeEach(() => {
  mocks.getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: "41000000-0000-0000-0000-000000000001", session_id: "42000000-0000-0000-0000-000000000001", exp: Math.floor(Date.now() / 1_000) + 300 } }, error: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: { status: "ok", source_kind: "official", total_votes: 3 }, error: null });
  mocks.schema.mockReset().mockReturnValue({ rpc: mocks.rpc });
  mocks.createClient.mockReset().mockResolvedValue({ auth: { getClaims: mocks.getClaims }, schema: mocks.schema });
});

describe("workspace official result GET", () => {
  it("uses one verified request client and passes only a bounded electoral selection", async () => {
    const response = await GET(new Request(URL));
    expect(response.status).toBe(200);
    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("official_result", { p_category_id: "51000000-0000-0000-0000-000000000001", p_circuito_code: null, p_distrito_code: "02", p_election_id: "50000000-0000-0000-0000-000000000001", p_establecimiento_code: null, p_mesa_code: null, p_requested_level: "seccion", p_seccion_code: "027" });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toMatchObject({ status: "ok", source_kind: "official" });
  });

  it("rejects malformed or repeated input before creating a client", async () => {
    const response = await GET(new Request(`${URL}&election_id=bad`));
    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ status: "invalid_request" });
  });
});
