import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import AuthenticatedLayout from "./layout";

const navigation = vi.hoisted(() => ({ pathname: "/dashboard" }));
const workspace = vi.hoisted(() => ({ reviewItems: vi.fn(), selection: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  usePathname: () => navigation.pathname,
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "authenticated-operator" } } }),
    },
  }),
}));

vi.mock("@/lib/workspace/context", () => ({
  authorizedReviewItems: workspace.reviewItems,
}));
vi.mock("@/lib/workspace/selection", () => ({
  loadWorkspaceSelection: workspace.selection,
}));

workspace.reviewItems.mockResolvedValue({ status: "ok", total: 0 });
workspace.selection.mockResolvedValue({ status: "active", revision: 2, activeOrganizationId: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13", organizations: [{ id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13", name: "Municipalidad" }], total: 1, truncated: false });

async function renderLayout(pathname: string): Promise<string> {
  navigation.pathname = pathname;
  return renderToStaticMarkup(
    (await AuthenticatedLayout({
      children: <p>Current page</p>,
    })) as ReactElement,
  );
}

it("renders the Command Ledger shell in keyboard order", async () => {
  const markup = await renderLayout("/dashboard");
  const sidebarIndex = markup.indexOf('<aside class="situation-sidebar">');
  const navigationIndex = markup.indexOf('<nav aria-label="principal"');
  const topbarIndex = markup.indexOf('<header class="workspace-topbar">');
  const mainIndex = markup.indexOf('id="main-content"');

  expect(sidebarIndex).toBeGreaterThanOrEqual(0);
  expect(primaryNavigation(markup)).toContain('<ul class="navigation-list">');
  expect(topbarIndex).toBeGreaterThan(navigationIndex);
  expect(mainIndex).toBeGreaterThan(topbarIndex);
  expect(markup).toContain('class="app-shell__workspace"');
  expect(markup).toContain('class="shell-container app-content"');
});

it.each([
  [{ status: "active", total: 1, truncated: false }, ["Organización", "Municipalidad", "Cambiar organización"]],
  [{ status: "stale", total: 1, truncated: false }, ["Tu acceso a la organización activa cambió. Seleccioná una organización autorizada nuevamente."]],
  [{ status: "revoked", total: 1, truncated: false }, ["El contexto de organización fue revocado. Volvé a iniciar sesión."]],
  [{ status: "expired", total: 1, truncated: false }, ["El contexto de organización venció. Volvé a iniciar sesión."]],
  [{ status: "mismatch", total: null, truncated: null }, ["No se pudo verificar que este contexto pertenezca a tu sesión."]],
  [{ status: "selection_required", total: 0, truncated: false }, ["No hay organizaciones disponibles."]],
  [{ status: "active", total: 101, truncated: true }, ["La lista está limitada a las primeras 100 de 101 organizaciones autorizadas"]],
])("renders workspace state $status distinctly", async (state, messages) => {
  workspace.selection.mockResolvedValueOnce({ revision: 2, activeOrganizationId: state.status === "active" ? "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13" : null, organizations: state.total === 0 ? [] : [{ id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13", name: "Municipalidad" }], ...state });
  const markup = await renderLayout("/dashboard");
  for (const message of messages) expect(markup).toContain(message);
});

it("renders exactly one keyboard-accessible sign-out form action", async () => {
  const markup = await renderLayout("/dashboard");
  const signOutForms =
    markup.match(
      /<form[^>]*>[\s\S]*?<button class="button button--secondary" type="submit">Cerrar sesión<\/button>[\s\S]*?<\/form>/g,
    ) ?? [];

  expect(signOutForms).toHaveLength(1);
  expect(signOutForms[0]).toMatch(/<form[^>]*\saction=/);
});

function primaryNavigation(markup: string): string {
  const navigationMarkup = markup.match(
    /<nav aria-label="principal"[\s\S]*?<\/nav>/,
  )?.[0];
  expect(navigationMarkup).toBeDefined();
  return navigationMarkup ?? "";
}

function currentPrimaryHrefs(markup: string): string[] {
  return [...primaryNavigation(markup).matchAll(/<a ([^>]*aria-current="page"[^>]*)>/g)]
    .map(([, attributes]) => attributes?.match(/href="([^"]+)"/)?.[1])
    .filter((href): href is string => typeof href === "string");
}

it.each([
  ["/dashboard", "/dashboard"],
  ["/drilldown", "/drilldown"],
  ["/compare", "/compare"],
  ["/municipal", "/municipal"],
  ["/fiscalizacion", "/fiscalizacion"],
  ["/simulate", "/simulate"],
  ["/review", "/review"],
])("marks only the %s route as the current page", async (pathname, href) => {
  expect(currentPrimaryHrefs(await renderLayout(pathname))).toEqual([href]);
});

it.each([
  ["/compare/districts", "/compare"],
  ["/municipal/coronel-rosales", "/municipal"],
  ["/simulate/", "/simulate"],
  ["/review/history", "/review"],
])("matches the %s route to its navigation family", async (pathname, href) => {
  expect(currentPrimaryHrefs(await renderLayout(pathname))).toEqual([href]);
});

it("does not treat a shared route prefix as a navigation family", async () => {
  expect(currentPrimaryHrefs(await renderLayout("/review-history"))).toEqual([]);
});

it("links authenticated operators to the seat simulation route", async () => {
  const markup = await renderLayout("/dashboard");

  expect(markup).toContain(
    '<div class="shell-container app-content" id="main-content" tabindex="-1">',
  );
  expect(markup.match(/id="main-content"/g) ?? []).toHaveLength(1);
  expect(markup).toContain('nav aria-label="principal"');
  expect(markup).toContain('href="/simulate"');
  expect(markup).toContain("Simulación 2027");
});

it("links authenticated operators to the official results explorer", async () => {
  const markup = await renderLayout("/dashboard");

  expect(markup).toContain('href="/drilldown"');
  expect(markup).toContain("Explorar");
});

it("surfaces an unknown review state", async () => { workspace.reviewItems.mockRejectedValueOnce(new Error("unavailable")); expect(await renderLayout("/dashboard")).toContain("No se pudo verificar el estado de revisión."); });
it("renders the authorized unresolved count from the verified workspace facade", async () => {
  workspace.reviewItems.mockResolvedValueOnce({ status: "ok", total: 3 });
  const markup = await renderLayout("/dashboard");

  expect(workspace.reviewItems).toHaveBeenCalledWith(expect.anything(), 0, 0);
  expect(markup).toContain("3 elemento(s) de revisión pendiente(s)");
});

it("renders all seven shared destinations in contract order with explicit source status", async () => {
  const markup = await renderLayout("/dashboard");
  const navigationMarkup = primaryNavigation(markup);
  const hrefs = [...navigationMarkup.matchAll(/<a ([^>]*)>/g)]
    .map(([, attributes]) => attributes?.match(/href="([^"]+)"/)?.[1])
    .filter((href): href is string => typeof href === "string");

  expect(markup).toContain("Esta herramienta no es una fuente electoral oficial.");
  expect(hrefs).toEqual([
    "/dashboard",
    "/drilldown",
    "/compare",
    "/municipal",
    "/fiscalizacion",
    "/simulate",
    "/review",
  ]);
  expect(navigationMarkup).toContain(
    '<section aria-labelledby="primary-navigation-situation-heading">',
  );
  expect(navigationMarkup).toContain(
    '<h2 id="primary-navigation-situation-heading">Situación</h2>',
  );
  expect(navigationMarkup).toContain(
    '<h2 id="primary-navigation-officialResults-heading">Resultados oficiales</h2>',
  );
  expect(navigationMarkup).toContain(
    '<section aria-describedby="primary-navigation-fiscalizacion-description" aria-labelledby="primary-navigation-fiscalizacion-heading">',
  );
  expect(navigationMarkup).toContain(
    '<h2 id="primary-navigation-fiscalizacion-heading">Fiscalización</h2>',
  );
  expect(navigationMarkup).toContain(
    '<p id="primary-navigation-fiscalizacion-description">Fuente no oficial, separada de los resultados oficiales.</p>',
  );
  expect(navigationMarkup).toContain(
    '<h2 id="primary-navigation-scenarios-heading">Escenarios</h2>',
  );
  expect(navigationMarkup).toContain(
    '<h2 id="primary-navigation-operations-heading">Operaciones</h2>',
  );
  expect(navigationMarkup).toContain("Resumen operativo");
  expect(navigationMarkup).toContain("Explorar");
  expect(navigationMarkup).toContain("Comparar");
  expect(navigationMarkup).toContain("Municipal");
  expect(navigationMarkup).toContain("Fiscalización (no oficial)");
  expect(navigationMarkup).toContain("Simulación 2027");
  expect(navigationMarkup).toContain("Revisión de datos");
});
