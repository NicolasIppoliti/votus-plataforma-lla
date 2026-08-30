import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import AuthenticatedLayout from "./layout";

const navigation = vi.hoisted(() => ({ pathname: "/dashboard" }));
const workspace = vi.hoisted(() => ({ reviewItems: vi.fn(), selection: vi.fn() }));
const globalStyles = readFileSync(new URL("../globals.css", import.meta.url), "utf8");

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

it("keeps authenticated header, navigation, and content on the shared centered container", async () => {
  const markup = await renderLayout("/dashboard");
  const navigationRule = globalStyles.match(/\.navigation-list\s*\{([^}]*)\}/)?.[1];

  expect(markup).toContain('class="shell-container site-header__inner"');
  expect(primaryNavigation(markup)).toContain('<ul class="shell-container navigation-list">');
  expect(markup).toContain('class="shell-container app-content"');
  expect(navigationRule).toBeDefined();
  expect(navigationRule).toMatch(/margin-block:\s*0;/);
  expect(navigationRule).not.toMatch(/(?:^|;)\s*margin\s*:/);
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
  ["/fiscalizacion", "/fiscalizacion"],
  ["/simulate", "/simulate"],
  ["/review", "/review"],
])("marks only the %s route as the current page", async (pathname, href) => {
  expect(currentPrimaryHrefs(await renderLayout(pathname))).toEqual([href]);
});

it.each([
  ["/simulate/", "/simulate"],
  ["/review/history", "/review"],
])("matches the %s route to its navigation family", async (pathname, href) => {
  expect(currentPrimaryHrefs(await renderLayout(pathname))).toEqual([href]);
});

it("does not treat a shared route prefix as a navigation family", async () => {
  expect(currentPrimaryHrefs(await renderLayout("/review-history"))).toEqual([]);
});

it.each(["/compare", "/municipal"])(
  "leaves intentionally unrepresented route %s without a current link",
  async (pathname) => {
    expect(currentPrimaryHrefs(await renderLayout(pathname))).toEqual([]);
  },
);

it("links authenticated operators to the seat simulation route", async () => {
  const markup = await renderLayout("/dashboard");

  expect(markup).toContain(
    '<div class="shell-container app-content" id="main-content" tabindex="-1">',
  );
  expect(markup.match(/id="main-content"/g) ?? []).toHaveLength(1);
  expect(markup).toContain('nav aria-label="principal"');
  expect(markup).toContain('href="/simulate"');
  expect(markup).toContain("Simulación de bancas");
});

it("links authenticated operators to the official results explorer", async () => {
  const markup = await renderLayout("/dashboard");

  expect(markup).toContain('href="/drilldown"');
  expect(markup).toContain("Explorar resultados");
});

it("surfaces an unknown review state", async () => { workspace.reviewItems.mockRejectedValueOnce(new Error("unavailable")); expect(await renderLayout("/dashboard")).toContain("No se pudo verificar el estado de revisión."); });
it("renders the authorized unresolved count from the verified workspace facade", async () => {
  workspace.reviewItems.mockResolvedValueOnce({ status: "ok", total: 3 });
  const markup = await renderLayout("/dashboard");

  expect(workspace.reviewItems).toHaveBeenCalledWith(expect.anything(), 0, 0);
  expect(markup).toContain("3 elemento(s) de revisión pendiente(s)");
});

it("preserves source status and keeps cold routes out of primary navigation", async () => {
  const markup = await renderLayout("/dashboard");
  const navigationMarkup = primaryNavigation(markup);

  expect(markup).toContain("Esta herramienta no es una fuente electoral oficial.");
  expect(navigationMarkup).toContain('href="/dashboard"');
  expect(navigationMarkup).toContain("Panel");
  expect(navigationMarkup).not.toContain('href="/compare"');
  expect(navigationMarkup).not.toContain(">Comparar<");
  expect(navigationMarkup).toContain('href="/fiscalizacion"');
  expect(navigationMarkup).toContain("Fiscalización (no oficial)");
  expect(navigationMarkup).not.toContain('href="/municipal"');
  expect(navigationMarkup).not.toContain(">Municipal (Concejales)<");
  expect(navigationMarkup).toContain('href="/simulate"');
  expect(navigationMarkup).toContain("Simulación de bancas");
  expect(navigationMarkup).toContain('href="/review"');
  expect(navigationMarkup).toContain("Revisión");
});
