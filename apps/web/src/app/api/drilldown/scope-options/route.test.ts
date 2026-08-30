import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), facets: vi.fn(), createClient: vi.fn(), createRepository: vi.fn() }));
vi.mock("@/lib/supabase/server-client", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/workspace/official-facets", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/workspace/official-facets")>(), createAuthorizedOfficialFacetRepository: mocks.createRepository,
}));
const { AuthorizedOfficialFacetsError, OFFICIAL_FACETS_ERROR } = await import("@/lib/workspace/official-facets");
const { POST } = await import("./route");

beforeEach(() => {
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: "user" } } });
  mocks.facets.mockReset().mockResolvedValue({ elections: [], categories: [], distritos: [], secciones: [], circuitos: [], establecimientos: [], mesas: [], availableLevels: [] });
  mocks.createClient.mockReset().mockResolvedValue({ auth: { getUser: mocks.getUser } });
  mocks.createRepository.mockReset().mockReturnValue({ facets: mocks.facets });
});
describe("drilldown scope-options route", () => {
  it("uses only the claims-bound repository and emits private exclusion evidence", async () => {
    mocks.facets.mockResolvedValue({ elections: [], categories: [], distritos: [], secciones: [], circuitos: [], establecimientos: [], mesas: [], availableLevels: [], exclusions: [{ reason: "non_official_source_rows", rows: 3 }] });
    const response = await POST(new Request("http://localhost/api/drilldown/scope-options", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(mocks.createRepository).toHaveBeenCalledOnce(); expect(mocks.facets).toHaveBeenCalledWith({});
    await expect(response.json()).resolves.toMatchObject({ capability: "official-exploration", meaning: "scope-options-only", facets: { exclusions: [{ reason: "non_official_source_rows", rows: 3 }] } });
  });

  it("returns only bounded overflow depth and count evidence", async () => { mocks.facets.mockRejectedValue(new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.PAYLOAD_TOO_LARGE,[{reason:"mesas_overflow",rows:240}]));
    const response=await POST(new Request("http://localhost/api/drilldown/scope-options",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}));
    expect(response.status).toBe(503); await expect(response.json()).resolves.toEqual({error:"payload_too_large",exclusions:[{reason:"mesas_overflow",rows:240}]});
  });

  it.each([
    [OFFICIAL_FACETS_ERROR.AUTHORIZATION_DENIED, 403, "authorization_denied"],
    [OFFICIAL_FACETS_ERROR.NONMEMBER, 422, "invalid_selection"],
    [OFFICIAL_FACETS_ERROR.UNAVAILABLE, 503, "unavailable"],
  ] as const)("maps %s without leaking provider detail", async (code, status, message) => {
    mocks.facets.mockRejectedValue(new AuthorizedOfficialFacetsError(code));
    const response = await POST(new Request("http://localhost/api/drilldown/scope-options", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({ error: message });
  });
});
