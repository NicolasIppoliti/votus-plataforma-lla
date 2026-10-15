import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "./(authenticated)/(home)/page";
import Drilldown from "./(authenticated)/drilldown/page";
import Compare from "./(authenticated)/compare/page";
import Municipal from "./(authenticated)/municipal/page";
import Fiscalizacion from "./(authenticated)/fiscalizacion/page";
import Review from "./(authenticated)/review/page";

const mocks = vi.hoisted(() => ({ selection: vi.fn(), client: vi.fn().mockRejectedValue(new Error("data must not be read before selection")) }));
vi.mock("@/lib/workspace/selection", () => ({ loadWorkspaceSelection: mocks.selection }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/server-client", () => ({ createSupabaseServerClient: mocks.client }));

beforeEach(() => { mocks.client.mockClear(); mocks.selection.mockResolvedValue({
  status: "selection_required", revision: 3, activeOrganizationId: null,
  organizations: [{ id: "00000000-0000-4000-8000-000000000001", name: "Organización de prueba" }],
  total: 1, truncated: false,
}); });

for (const [route, Page] of [["/", Home], ["/drilldown", Drilldown], ["/compare", Compare], ["/municipal", Municipal], ["/fiscalizacion", Fiscalizacion], ["/review", Review]] as const) {
  describe(`${route} workspace state through the real page`, () => {
    it("renders the shared actionable selection state inline", async () => {
      const markup = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }) as ReactElement);
      expect(markup).toContain('aria-label="Selección de organización"');
      expect(markup).toContain("Seleccioná una organización");
      expect(markup).toContain("Organización de prueba");
      expect(markup).toContain("Cambiar organización");
      expect(markup).toContain('data-variant="needs-selection"');
      expect(mocks.client).not.toHaveBeenCalled();
    });
    it("reports no available organizations without inventing a selection", async () => {
      mocks.selection.mockResolvedValue({ status: "selection_required", revision: 3, activeOrganizationId: null, organizations: [], total: 0, truncated: false });
      const markup = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }) as ReactElement);
      expect(markup).toContain("No hay organizaciones disponibles.");
      expect(markup).not.toContain("<select");
      expect(mocks.client).not.toHaveBeenCalled();
    });
    it.each([
      ["denied", "No tenés autorización para acceder a esta organización."],
      ["expired", "El contexto de organización venció. Volvé a iniciar sesión."],
      ["revoked", "El contexto de organización fue revocado. Volvé a iniciar sesión."],
      ["unavailable", "No se pudo verificar la organización. Intentá de nuevo más tarde."],
    ])("keeps %s copy distinct from selection", async (status, copy) => {
      mocks.selection.mockResolvedValue({ status, revision: null, activeOrganizationId: null, organizations: [], total: null, truncated: null });
      const markup = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }) as ReactElement);
      expect(markup).toContain(copy);
      expect(markup).not.toContain("Cambiar organización");
      expect(markup).not.toContain("Seleccioná una organización");
    });
  });
}
