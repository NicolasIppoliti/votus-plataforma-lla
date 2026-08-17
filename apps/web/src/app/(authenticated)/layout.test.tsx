import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import AuthenticatedLayout from "./layout";

const navigation = vi.hoisted(() => ({ pathname: "/dashboard" }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  usePathname: () => navigation.pathname,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "authenticated-operator" } } }),
    },
    from: () => ({
      select: () => ({
        maybeSingle: async () => ({ data: { unresolved_count: 0 } }),
      }),
    }),
  }),
}));

async function renderLayout(pathname: string): Promise<string> {
  navigation.pathname = pathname;
  return renderToStaticMarkup(
    (await AuthenticatedLayout({
      children: <p>Current page</p>,
    })) as ReactElement,
  );
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
