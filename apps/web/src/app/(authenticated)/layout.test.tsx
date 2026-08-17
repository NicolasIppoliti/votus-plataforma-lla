import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import AuthenticatedLayout from "./layout";

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
it("links authenticated operators to the seat simulation route", async () => {
  const markup = renderToStaticMarkup(
    (await AuthenticatedLayout({
      children: <p>Current page</p>,
    })) as ReactElement,
  );

  expect(markup).toContain(
    '<div class="shell-container app-content" id="main-content" tabindex="-1">',
  );
  expect(markup.match(/id="main-content"/g) ?? []).toHaveLength(1);
  expect(markup).toContain('nav aria-label="principal"');
  expect(markup).toContain('href="/simulate"');
  expect(markup).toContain("Simulación de bancas");
});

it("links authenticated operators to the official results explorer", async () => {
  const markup = renderToStaticMarkup(
    (await AuthenticatedLayout({ children: <p>Current page</p> })) as ReactElement,
  );

  expect(markup).toContain('href="/drilldown"');
  expect(markup).toContain("Explorar resultados");
});

it("preserves source status and keeps cold routes out of primary navigation", async () => {
  const markup = renderToStaticMarkup(
    (await AuthenticatedLayout({ children: <p>Current page</p> })) as ReactElement,
  );
  const primaryNavigation = markup.match(
    /<nav aria-label="principal"[\s\S]*?<\/nav>/,
  )?.[0];

  expect(markup).toContain("Esta herramienta no es una fuente electoral oficial.");
  expect(primaryNavigation).toBeDefined();
  expect(primaryNavigation).toContain('href="/dashboard"');
  expect(primaryNavigation).toContain("Panel");
  expect(primaryNavigation).not.toContain('href="/compare"');
  expect(primaryNavigation).not.toContain(">Comparar<");
  expect(primaryNavigation).toContain('href="/fiscalizacion"');
  expect(primaryNavigation).toContain("Fiscalización (no oficial)");
  expect(primaryNavigation).not.toContain('href="/municipal"');
  expect(primaryNavigation).not.toContain(">Municipal (Concejales)<");
  expect(primaryNavigation).toContain('href="/simulate"');
  expect(primaryNavigation).toContain("Simulación de bancas");
  expect(primaryNavigation).toContain('href="/review"');
  expect(primaryNavigation).toContain("Revisión");
});
