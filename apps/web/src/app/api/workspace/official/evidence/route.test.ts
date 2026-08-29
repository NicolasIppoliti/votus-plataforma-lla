import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadEvidence: vi.fn() }));
vi.mock("../../../../../lib/workspace/official-drilldown-evidence", () => ({
  loadAuthorizedOfficialDrilldownEvidence: mocks.loadEvidence,
}));
const { GET } = await import("./route");

const URL = "http://localhost/api/workspace/official/evidence?election_id=50000000-0000-0000-0000-000000000001&category_id=51000000-0000-0000-0000-000000000001&distrito_code=02&seccion_code=027&circuito_code=circuito-X&requested_level=seccion";
const PRIVATE_CACHE = "private, no-store, max-age=0";

beforeEach(() => {
  mocks.loadEvidence.mockReset().mockResolvedValue({ status: "ok", result: {}, schools: {}, reference: [], provenance: [] });
});

describe("workspace official evidence GET", () => {
  it("loads one bounded electoral selection through the authorized evidence module", async () => {
    const response = await GET(new Request(URL));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(PRIVATE_CACHE);
    expect(mocks.loadEvidence).toHaveBeenCalledWith({
      electionId: "50000000-0000-0000-0000-000000000001",
      categoryId: "51000000-0000-0000-0000-000000000001",
      distritoCode: "02",
      seccionCode: "027",
      circuitoCode: "circuito-X",
      establecimientoCode: null,
      mesaCode: null,
      requestedLevel: "seccion",
    });
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it.each([
    ["repeated input", `${URL}&election_id=50000000-0000-0000-0000-000000000001`],
    ["missing section", URL.replace("&seccion_code=027", "")],
    ["caller authority", `${URL}&organization_id=40000000-0000-0000-0000-000000000001`],
  ])("rejects %s before loading evidence", async (_case, url) => {
    const response = await GET(new Request(url));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe(PRIVATE_CACHE);
    expect(mocks.loadEvidence).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ status: "invalid_request" });
  });

  it("hides loader failures behind one private unavailable response", async () => {
    mocks.loadEvidence.mockRejectedValue(new Error("private transport detail"));

    const response = await GET(new Request(URL));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe(PRIVATE_CACHE);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
