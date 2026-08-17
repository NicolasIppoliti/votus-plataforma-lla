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

it("preserves source status and every existing workflow label", async () => {
  const markup = renderToStaticMarkup(
    (await AuthenticatedLayout({ children: <p>Current page</p> })) as ReactElement,
  );

  expect(markup).toContain("Esta herramienta no es una fuente electoral oficial.");
  expect(markup).toContain('nav aria-label="principal"');
  expect(markup).toContain('href="/dashboard"');
  expect(markup).toContain("Panel");
  expect(markup).toContain('href="/compare"');
  expect(markup).toContain("Comparar");
  expect(markup).toContain('href="/fiscalizacion"');
  expect(markup).toContain("Fiscalización (no oficial)");
  expect(markup).toContain('href="/municipal"');
  expect(markup).toContain("Municipal (Concejales)");
  expect(markup).toContain('href="/simulate"');
  expect(markup).toContain("Simulación de bancas");
  expect(markup).toContain('href="/review"');
  expect(markup).toContain("Revisión");
});
