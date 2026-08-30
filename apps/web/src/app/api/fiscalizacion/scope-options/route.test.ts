import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ facets: vi.fn(), createRepository: vi.fn() }));
vi.mock("@/lib/workspace/official-facets", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/workspace/official-facets")>(),
  createAuthorizedOfficialFacetRepository: mocks.createRepository,
}));
const { AuthorizedOfficialFacetsError, OFFICIAL_FACETS_ERROR } = await import("@/lib/workspace/official-facets");
const { POST } = await import("./route");
const emptyFacets = { elections: [], categories: [], distritos: [], secciones: [], circuitos: [], establecimientos: [], mesas: [], availableLevels: [] };

beforeEach(() => {
  mocks.facets.mockReset().mockResolvedValue(emptyFacets);
  mocks.createRepository.mockReset().mockReturnValue({ facets: mocks.facets });
});

describe("fiscalizacion scope-options route", () => {
  it("uses only the claims-bound authorized seam and returns a strict private payload", async () => {
    const response = await POST(new Request("http://localhost/api/fiscalizacion/scope-options", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    expect(response.status).toBe(200);
    expect(mocks.createRepository).toHaveBeenCalledOnce(); expect(mocks.facets).toHaveBeenCalledWith({});
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({ capability: "coverage-scope-options", meaning: "scope-options-only", selection: {}, facets: emptyFacets });
  });

  it.each([
    ["authorization denial", new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.AUTHORIZATION_DENIED), 403, "authorization_denied"],
    ["provider failure", new Error("secret provider detail"), 503, "unavailable"],
  ] as const)("keeps %s distinct and private", async (_case, failure, status, error) => {
    mocks.facets.mockRejectedValue(failure);
    const response = await POST(new Request("http://localhost/api/fiscalizacion/scope-options", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    const body = await response.json(); expect(body).toEqual({ error });
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
