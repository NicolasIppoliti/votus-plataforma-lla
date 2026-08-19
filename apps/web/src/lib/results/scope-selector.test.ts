import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCOPE_CAPABILITY, createScopeOptionsHandler, type ScopeOptionsDependencies, } from "./scope-selector";
import type { ExplorationFacets } from "./exploration";

const IDS = {
  ELECTION: "10000000-0000-4000-8000-000000000001", CATEGORY: "10000000-0000-4000-8000-000000000002",
} as const;
const FACETS: ExplorationFacets = {
  elections: [{ id: IDS.ELECTION, year: 2025, round: "general", label: "2025 general" }],
  categories: [{ id: IDS.CATEGORY, name: "Diputados" }],
  distritos: [{ code: "02", name: "Buenos Aires", nameStatus: "present", nameVariantCount: 1 }],
  secciones: [{ code: "027", name: "Bahía Blanca", nameStatus: "present", nameVariantCount: 1 }],
  circuitos: [{ code: "00001", name: null, nameStatus: "missing", nameVariantCount: 0 }],
  establecimientos: [{ code: "E1", name: "School", nameStatus: "present", nameVariantCount: 1 }],
  mesas: [{ code: 7 }], availableLevels: ["distrito", "seccion", "circuito", "establecimiento", "mesa"],
};
const facets = vi.fn();
let authenticated = true;
const dependencies: ScopeOptionsDependencies = { authenticate: async () => authenticated ? { facets } : null, };
function request(body: unknown, contentType = "application/json"): Request {
  return new Request("http://localhost/api", { method: "POST", headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body), });
}
const valid = { electionId: IDS.ELECTION, categoryId: IDS.CATEGORY, distritoCode: "02" };
beforeEach(() => { authenticated = true; facets.mockReset().mockResolvedValue(FACETS); });
describe("scope options handler", () => {
  it("returns 401 before parsing an unauthenticated request", async () => {
    authenticated = false;
    expect((await createScopeOptionsHandler(SCOPE_CAPABILITY.OFFICIAL, dependencies)(request("{"))).status).toBe(401);
  });
  it.each([
    ["non-JSON", valid, "text/plain"], ["malformed", "{", "application/json"],
    ["oversized", { electionId: IDS.ELECTION, distritoCode: "x".repeat(129) }, "application/json"],
    ["unknown", { electionId: IDS.ELECTION, capability: SCOPE_CAPABILITY.COVERAGE }, "application/json"],
  ])("rejects %s bodies as malformed", async (_case, body, contentType) => {
    const response = await createScopeOptionsHandler(SCOPE_CAPABILITY.OFFICIAL, dependencies)(request(body, contentType));
    expect(response.status).toBe(400); expect(facets).not.toHaveBeenCalled();
  });
  it("rejects incomplete parent chains without an RPC", async () => {
    const response = await createScopeOptionsHandler(SCOPE_CAPABILITY.OFFICIAL, dependencies)(request(
      { electionId: IDS.ELECTION, categoryId: IDS.CATEGORY, seccionCode: "027", }));
    expect(response.status).toBe(422); expect(facets).not.toHaveBeenCalled();
  });
  it("rejects nonmember options after exactly one RPC", async () => {
    const response = await createScopeOptionsHandler(SCOPE_CAPABILITY.OFFICIAL, dependencies)(request({ ...valid, distritoCode: "99", }));
    expect(response.status).toBe(422); expect(facets).toHaveBeenCalledTimes(1);
  });
  it("rejects an unavailable official level", async () => {
    facets.mockResolvedValue({ ...FACETS, availableLevels: ["distrito"] });
    const response = await createScopeOptionsHandler(SCOPE_CAPABILITY.OFFICIAL, dependencies)(request(
      { ...valid, seccionCode: "027", level: "seccion", }));
    expect(response.status).toBe(422); expect(facets).toHaveBeenCalledTimes(1);
  });
  it("rejects official-only selectors on the coverage capability", async () => {
    const response = await createScopeOptionsHandler(SCOPE_CAPABILITY.COVERAGE, dependencies)(request(
      { ...valid, seccionCode: "027", circuitoCode: "00001", }));
    expect(response.status).toBe(422); expect(facets).not.toHaveBeenCalled();
  });
  it("normalizes selection before membership, RPC, and response", async () => {
    facets.mockResolvedValue({ ...FACETS, circuitos: [{ ...FACETS.circuitos[0], code: "00248" }] });
    const response = await createScopeOptionsHandler(SCOPE_CAPABILITY.OFFICIAL, dependencies)(request({
      ...valid, distritoCode: "2", seccionCode: "27", circuitoCode: "248", establecimientoCode: " E1 ", mesaCode: 7, level: "mesa",
    }));
    expect(response.status).toBe(200);
    expect(facets).toHaveBeenCalledWith({ electionId: IDS.ELECTION, categoryId: IDS.CATEGORY, distritoCode: "02",
      seccionCode: "027", circuitoCode: "00248", establecimientoCode: "E1" });
    await expect(response.json()).resolves.toMatchObject({ selection: { ...valid, seccionCode: "027",
      circuitoCode: "00248", establecimientoCode: "E1", mesaCode: 7, level: "mesa", } });
  });
  it("rejects malformed administrative normalization without an RPC", async () => {
    const response = await createScopeOptionsHandler(SCOPE_CAPABILITY.OFFICIAL, dependencies)(request({ ...valid, distritoCode: "O2" }));
    expect(response.status).toBe(422); expect(facets).not.toHaveBeenCalled();
  });
  it("returns a safe 503 when the provider fails", async () => {
    facets.mockRejectedValue(new Error("secret provider detail"));
    const response = await createScopeOptionsHandler(SCOPE_CAPABILITY.OFFICIAL, dependencies)(request(valid));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
  });
});
