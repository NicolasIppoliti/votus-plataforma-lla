import { beforeEach, expect, it, vi } from "vitest";
import { loadContextOptions } from "./context-actions";

const { facets } = vi.hoisted(() => ({ facets: vi.fn() }));
vi.mock("@/lib/workspace/official-facets", () => ({ createAuthorizedOfficialFacetRepository: () => ({ facets }) }));
const context = { electionId: "e", categoryId: "a", distritoCode: "02", seccionCode: "027", sourceKind: "official" };
vi.mock("@/lib/context/default", () => ({ resolveDefaultElectoralContext: async () => context }));
beforeEach(() => {
  facets.mockReset();
  facets.mockImplementation(async (selection) => ({
    elections: selection.electionId ? ["e"] : ["e", "other-election"],
    categories: selection.categoryId ? ["a"] : ["a", "b"],
    distritos: selection.distritoCode ? ["02"] : ["02", "03"],
    secciones: selection.seccionCode ? ["027"] : ["027", "028"],
    circuitos: [], establecimientos: [], mesas: [], availableLevels: [], exclusions: [],
  }));
});
it.each(["electionId=e&categoryId=a&distritoCode=02&seccionCode=027", ""])("keeps sibling choices available after resolving context (%s)", async query => {
  const result = await loadContextOptions(query);
  expect(result?.context).toEqual(context);
  expect(result?.facets.elections).toEqual(["e", "other-election"]);
  expect(result?.facets.categories).toEqual(["a", "b"]);
  expect(result?.facets.distritos).toEqual(["02", "03"]);
  expect(result?.facets.secciones).toEqual(["027", "028"]);
});
it("fails closed if the selected scope cannot be authorized", async () => {
  facets.mockRejectedValue(new Error("denied"));
  expect(await loadContextOptions("electionId=e")).toBeNull();
});
