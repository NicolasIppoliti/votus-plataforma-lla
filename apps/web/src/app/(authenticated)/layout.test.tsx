import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import AuthenticatedLayout from "./layout";
import OperationalBriefingPage from "./page";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
const workspace = vi.hoisted(() => ({ reviewItems: vi.fn(), selection: vi.fn() }));
const supabase = vi.hoisted(() => ({
  auth: {
    getUser: async () => ({ data: { user: { id: "authenticated-operator" } } }),
  },
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  usePathname: () => navigation.pathname,
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: async () => supabase,
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

it("renders a closed mobile drawer from the shared navigation contract", async () => {
  const markup = await renderLayout("/dashboard");
  const drawerMarkup = mobileDrawer(markup);

  expect(markup).toContain(
    'aria-controls="mobile-navigation-drawer" aria-expanded="false"',
  );
  expect(drawerMarkup).not.toMatch(/<dialog[^>]*\sopen(?:\s|=|>)/);
  expect(drawerMarkup).toContain('<aside class="situation-sidebar">');
  expect(drawerMarkup).toContain(
    "Esta herramienta no es una fuente electoral oficial.",
  );
  expect(drawerMarkup.match(/<nav aria-label="principal"/g) ?? []).toHaveLength(1);
  const drawerNavigation = drawerMarkup.match(
    /<nav aria-label="principal"[\s\S]*?<\/nav>/,
  )?.[0] ?? "";
  expect([...drawerNavigation.matchAll(/<a ([^>]*)>/g)]
    .map(([, attributes]) => attributes?.match(/href="([^"]+)"/)?.[1])
    .filter((href): href is string => typeof href === "string"))
    .toEqual([
      "/",
      "/drilldown",
      "/compare",
      "/municipal",
      "/fiscalizacion",
      "/simulate",
      "/review",
    ]);
});

it("renders one real sign-out action per sidebar footer with unique organization labels", async () => {
  const markup = await renderLayout("/");
  const footers = markup.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/g) ?? [];
  expect(footers).toHaveLength(2);
  const selectorIds: string[] = [];
  for (const footer of footers) {
    expect(footer).toContain('aria-label="Organización y cuenta"');
    const account = footer.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0] ?? "";
    expect(account).not.toMatch(/<details[^>]*\sopen(?:\s|=|>)/);
    expect(account).toContain("<summary>Cuenta</summary>");
    const forms = account.match(/<form\b[^>]*>[\s\S]*?<\/form>/g) ?? [];
    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatch(/<form[^>]*\saction=/);
    expect(forms[0]).toContain('type="submit">Cerrar sesión</button>');
    const id = footer.match(/<select id="([^"]+)"/)?.[1] ?? "";
    expect(id).not.toBe("");
    expect(footer).toContain(`<label for="${id}">Organización</label>`);
    selectorIds.push(id);
    expect(footer.indexOf("<select")).toBeLessThan(footer.indexOf("<details"));
  }
  expect(new Set(selectorIds).size).toBe(2);
  const topbar = markup.replace(mobileDrawer(markup), "").match(/<header class="workspace-topbar">[\s\S]*?<\/header>/)?.[0];
  expect(topbar).not.toContain("<form");
  expect(topbar).toContain("Organización activa:");
});

function mobileDrawer(markup: string): string {
  const drawerMarkup = markup.match(
    /<dialog[^>]*id="mobile-navigation-drawer"[\s\S]*?<\/dialog>/,
  )?.[0];
  expect(drawerMarkup).toBeDefined();
  return drawerMarkup ?? "";
}

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
  ["/", "/"],
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

it("shares one authorized pending count between the topbar and root operational attention", async () => {
  navigation.pathname = "/";
  workspace.reviewItems.mockClear();
  workspace.reviewItems.mockResolvedValueOnce({ status: "ok", total: 7 });

  const markup = renderToStaticMarkup(
    await AuthenticatedLayout({ children: <OperationalBriefingPage /> }),
  );

  expect(workspace.reviewItems).toHaveBeenCalledExactlyOnceWith(supabase, 0, 0);
  const topbar = markup.match(/<header class="workspace-topbar">[\s\S]*?<\/header>/)?.[0];
  expect(topbar).toContain("7 elemento(s) de revisión pendiente(s)");

  const main = markup.match(/<main\b[^>]*>[\s\S]*?<\/main>/)?.[0];
  expect(main).toBeDefined();
  expect(main).toContain("Atención operativa");
  const attention = main?.match(
    /<(?:section|aside)\b[^>]*>(?:(?!<\/(?:section|aside)>)[\s\S])*Atención operativa[\s\S]*?<\/(?:section|aside)>/,
  )?.[0];
  expect(attention).toBeDefined();
  expect(attention).toMatch(/\b7\b/);
  expect(attention).toContain('href="/review"');
});

it.each([
  [{ status: "ok", total: 0 }, "Sin elementos pendientes"],
  [undefined, "No se pudo verificar el estado de revisión."],
  [{ status: "denied", total: 7 }, "No se pudo verificar el estado de revisión."],
  [{ status: "ok", total: -1 }, "No se pudo verificar el estado de revisión."],
  [{ status: "ok", total: 0.5 }, "No se pudo verificar el estado de revisión."],
  [{ status: "ok", total: Number.MAX_SAFE_INTEGER + 1 }, "No se pudo verificar el estado de revisión."],
  [{ status: "ok", total: "7" }, "No se pudo verificar el estado de revisión."],
  [{ status: "ok", total: NaN }, "No se pudo verificar el estado de revisión."],
] as const)("keeps root attention and topbar aligned for review payload %j", async (payload, message) => {
  workspace.reviewItems.mockClear();
  workspace.reviewItems.mockResolvedValueOnce(payload);
  const markup = renderToStaticMarkup(await AuthenticatedLayout({ children: <OperationalBriefingPage /> }));
  expect(workspace.reviewItems).toHaveBeenCalledExactlyOnceWith(supabase, 0, 0);
  const main = markup.match(/<main\b[^>]*>[\s\S]*?<\/main>/)?.[0] ?? "";
  const topbar = markup.replace(mobileDrawer(markup), "").match(/<header class="workspace-topbar">[\s\S]*?<\/header>/)?.[0] ?? "";
  for (const reader of [main, topbar]) {
    expect(reader).toContain(message);
    expect(reader).not.toContain("elemento(s) de revisión pendiente(s)");
    if (payload?.total !== 0) expect(reader).not.toContain("Sin elementos pendientes");
  }
  for (const href of ["/drilldown", "/compare", "/municipal", "/fiscalizacion", "/simulate", "/review"]) {
    expect(main).toContain(`href="${href}"`);
  }
});

it.each(["stale", "revoked", "expired", "mismatch", "selection_required", "denied", "conflict", "unavailable"])(
  "suppresses a returned count when workspace selection is %s", async (status) => {
    workspace.selection.mockResolvedValueOnce({ status, revision: 2, activeOrganizationId: null, organizations: [], total: 0, truncated: false });
    workspace.reviewItems.mockClear();
    workspace.reviewItems.mockResolvedValueOnce({ status: "ok", total: 7 });
    const markup = renderToStaticMarkup(await AuthenticatedLayout({ children: <OperationalBriefingPage /> }));
    expect(workspace.reviewItems).toHaveBeenCalledExactlyOnceWith(supabase, 0, 0);
    expect(markup.match(/No se pudo verificar el estado de revisión\./g)).toHaveLength(2);
    expect(markup).not.toContain("elemento(s) de revisión pendiente(s)");
    expect(markup).not.toContain("Sin elementos pendientes");
    expect(markup).not.toContain("Organización activa:");
  },
);

it("keeps real root attention unknown after the review request throws", async () => {
  workspace.reviewItems.mockClear();
  workspace.reviewItems.mockRejectedValueOnce(new Error("unavailable"));
  const markup = renderToStaticMarkup(await AuthenticatedLayout({ children: <OperationalBriefingPage /> }));
  expect(workspace.reviewItems).toHaveBeenCalledExactlyOnceWith(supabase, 0, 0);
  expect(markup.match(/No se pudo verificar el estado de revisión\./g)).toHaveLength(2);
  expect(markup).not.toContain("Sin elementos pendientes");
});

it("renders all seven shared destinations in contract order with explicit source status", async () => {
  const markup = await renderLayout("/dashboard");
  const navigationMarkup = primaryNavigation(markup);
  const hrefs = [...navigationMarkup.matchAll(/<a ([^>]*)>/g)]
    .map(([, attributes]) => attributes?.match(/href="([^"]+)"/)?.[1])
    .filter((href): href is string => typeof href === "string");

  expect(markup).toContain("Esta herramienta no es una fuente electoral oficial.");
  expect(hrefs).toEqual([
    "/",
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
