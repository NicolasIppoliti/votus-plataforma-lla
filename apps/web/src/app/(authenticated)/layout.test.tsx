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

  expect(markup).toContain('nav aria-label="main"');
  expect(markup).toContain('href="/simulate"');
  expect(markup).toContain("Seat simulation");
});
