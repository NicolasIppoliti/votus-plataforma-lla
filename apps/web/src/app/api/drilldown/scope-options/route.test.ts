import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), facets: vi.fn(), createClient: vi.fn(), createRepository: vi.fn(),
}));
vi.mock("@/lib/supabase/server-client", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/results/exploration", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/results/exploration")>(),
  createResultsExplorationRepository: mocks.createRepository,
}));
const { POST } = await import("./route");

beforeEach(() => {
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: "user" } } });
  mocks.facets.mockReset().mockResolvedValue({ elections: [], categories: [], distritos: [], secciones: [],
    circuitos: [], establecimientos: [], mesas: [], availableLevels: [] });
  mocks.createClient.mockReset().mockResolvedValue({ auth: { getUser: mocks.getUser } });
  mocks.createRepository.mockReset().mockReturnValue({ facets: mocks.facets });
});
describe("drilldown scope-options route", () => {
  it("wires production authentication/repository dependencies with a fixed capability", async () => {
    const response = await POST(new Request("http://localhost/api/drilldown/scope-options", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    expect(response.status).toBe(200);
    expect(mocks.createClient).toHaveBeenCalledOnce(); expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.createRepository).toHaveBeenCalledOnce(); expect(mocks.facets).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      capability: "official-exploration", meaning: "scope-options-only",
    });
  });
});
