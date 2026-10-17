import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
const mocks = vi.hoisted(() => ({ selection: vi.fn(), facets: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace/selection", () => ({ loadWorkspaceSelection: mocks.selection }));
vi.mock("@/lib/workspace/official-facets", () => ({ createAuthorizedOfficialFacetRepository: () => ({ facets: mocks.facets }) }));
vi.mock("./actions", () => ({ chooseOrganization: vi.fn(), finishOnboarding: vi.fn() }));
const org = { id: "org-one", name: "Organización de prueba" };
const territory = (code: string, name: string) => ({ code, name, nameStatus: "present", nameVariantCount: 1 });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.selection.mockResolvedValue({ status: "active", revision: 2, activeOrganizationId: org.id, organizations: [org], total: 1, truncated: false });
  mocks.facets.mockImplementation(async (selection: Record<string, string>) => ({
    elections: [{ id: "e2025", year: 2025, round: "general", label: "2025 general" }],
    categories: selection.electionId ? [{ id: "council", name: "CONCEJALES" }] : [],
    distritos: selection.categoryId ? [territory("02", "Buenos Aires")] : [],
    secciones: selection.distritoCode ? [territory("027", "Coronel Rosales")] : [],
    circuitos: [], establecimientos: [], mesas: [], availableLevels: [], exclusions: [],
  }));
});
const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
it("renders organization selection before reading electoral scope", async () => {
  mocks.selection.mockResolvedValue({ status: "selection_required", revision: 1, activeOrganizationId: null, organizations: [org, { id: "two", name: "Otra organización" }], total: 2, truncated: false });
  const html = await render({ paso: "guia" });
  expect(html).toContain("Elegí tu organización");
  expect(html).toContain("Otra organización");
  expect(html).toContain('aria-current="step"');
  expect(mocks.facets).not.toHaveBeenCalled();
});
it("skips organization selection for an active sole organization and groups scope together", async () => {
  const html = await render();
  expect(html).toContain("Tu alcance de trabajo");
  for (const text of [org.name, "2025 general", "CONCEJALES", "Buenos Aires", "Coronel Rosales"]) expect(html).toContain(text);
  expect(html).not.toContain('name="organizationId"');
  expect(html).toContain("paso=guia");
  expect(mocks.facets).toHaveBeenCalledWith({ electionId: "e2025", categoryId: "council", distritoCode: "02" });
});
it("keeps module guidance separate from scope without changing organizations", async () => {
  const html = await render({ paso: "guia", returnTo: "/compare?year=2025" });
  expect(html).toContain("Una guía para cada tarea");
  for (const label of ["Panorama", "Exploración", "Municipal", "Comparación", "Simulación", "Evidencia", "Revisión", "Fiscalización"]) expect(html).toContain(label);
  expect(html).toContain("no oficial");
  expect(html).not.toContain('name="organizationId"');
  expect(mocks.facets).not.toHaveBeenCalled();
});
it("offers a real completion form and retains only a safe return destination", async () => {
  const html = await render({ paso: "ingreso", returnTo: "/compare?year=2025" });
  expect(html).toContain("Ingresar a Votus");
  expect(html).toContain('name="returnTo" value="/compare?year=2025"');
  expect(await render({ paso: "ingreso", returnTo: "https://evil.invalid" })).not.toContain("evil.invalid");
});
it("distinguishes an unavailable scope from no authorized data", async () => {
  mocks.facets.mockRejectedValue(new Error("private database details"));
  const html = await render();
  expect(html).toContain("No se pudo cargar el alcance");
  expect(html).toContain("Reintentar");
  expect(html).not.toContain("private database details");
  expect(html).not.toContain("No hay resultados oficiales disponibles");
});
it("keeps exclusion reasons and row counts visible beside the matching scope", async () => {
  mocks.facets.mockResolvedValue({ elections: [], categories: [], distritos: [], secciones: [], exclusions: [{ reason: "official_rows_with_incomplete_lineage", rows: 7 }] });
  const html = await render();
  expect(html).toContain("official_rows_with_incomplete_lineage");
  expect(html).toContain("7");
  expect(html).toContain("No hay resultados oficiales disponibles");
});
it("explains missing memberships without showing an enter button", async () => {
  mocks.selection.mockResolvedValue({ status: "selection_required", revision: 1, organizations: [], total: 0, truncated: false });
  const html = await render();
  expect(html).toContain("No hay organizaciones disponibles");
  expect(html).not.toContain("Ingresar a Votus");
  expect(mocks.facets).not.toHaveBeenCalled();
});
