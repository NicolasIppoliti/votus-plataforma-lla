import { describe, expect, it, vi } from "vitest";
import { AuthorizedOfficialFacetRepository, OFFICIAL_FACETS_ERROR } from "./official-facets";

const IDS = { election: "10000000-0000-4000-8000-000000000001", category: "20000000-0000-4000-8000-000000000001" } as const;
const row = { election_id: IDS.election, year: 2025, round: "generales", category_id: IDS.category,
  category_name: "DIPUTADOS", distrito_code: "02", distrito_name: "Buenos Aires",
  distrito_name_status: "present", distrito_name_variant_count: 1, seccion_code: "027",
  seccion_name: "Coronel Rosales", seccion_name_status: "present", seccion_name_variant_count: 1 };
const payload = (facets: unknown[] = [row], extra: Record<string, unknown> = {}) =>
  ({ status: "ok", facets, total: facets.length, truncated: false, ...extra });

describe("AuthorizedOfficialFacetRepository", () => {
  it("projects the authorized flat tuples only after each parent is selected", async () => {
    const load = vi.fn().mockResolvedValue(payload());
    const repository = new AuthorizedOfficialFacetRepository(load);
    const cold = await repository.facets({});
    const category = await repository.facets({ electionId: IDS.election });
    const district = await repository.facets({ electionId: IDS.election, categoryId: IDS.category });
    const section = await repository.facets({ electionId: IDS.election, categoryId: IDS.category, distritoCode: "02" });
    expect(cold).toMatchObject({ elections: [{ id: IDS.election, label: "2025 generales" }], categories: [], distritos: [], secciones: [] });
    expect(category.categories).toEqual([{ id: IDS.category, name: "DIPUTADOS" }]);
    expect(district.distritos).toEqual([{ code: "02", name: "Buenos Aires", nameStatus: "present", nameVariantCount: 1 }]);
    expect(section.secciones).toEqual([{ code: "027", name: "Coronel Rosales", nameStatus: "present", nameVariantCount: 1 }]);
    expect(section).toMatchObject({ circuitos: [], establecimientos: [], mesas: [], availableLevels: [] });
    expect(load).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["denial", payload([], { status: "context_stale" }), {}, OFFICIAL_FACETS_ERROR.AUTHORIZATION_DENIED],
    ["truncation", payload([row], { truncated: true }), {}, OFFICIAL_FACETS_ERROR.MALFORMED],
    ["count mismatch", payload([row], { total: 2 }), {}, OFFICIAL_FACETS_ERROR.MALFORMED],
    ["malformed row", payload([{ ...row, year: "2025" }]), {}, OFFICIAL_FACETS_ERROR.MALFORMED],
    ["duplicate tuple", payload([row, row]), {}, OFFICIAL_FACETS_ERROR.MALFORMED],
    ["conflicting metadata", payload([row, { ...row, seccion_code: "028", distrito_name: "PBA" }]), {}, OFFICIAL_FACETS_ERROR.MALFORMED],
    ["nonmember selection", payload(), { electionId: "30000000-0000-4000-8000-000000000001" }, OFFICIAL_FACETS_ERROR.NONMEMBER],
  ] as const)("rejects %s", async (_case, raw, selection, code) => {
    await expect(new AuthorizedOfficialFacetRepository(() => Promise.resolve(raw)).facets(selection)).rejects.toMatchObject({ code });
  });

  it("keeps authorized empty distinct from authorization denial", async () => {
    await expect(new AuthorizedOfficialFacetRepository(() => Promise.resolve(payload([]))).facets({})).resolves.toMatchObject({ elections: [] });
  });
});
