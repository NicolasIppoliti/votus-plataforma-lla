import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import LoginPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

it("renders the login page as the public skip destination", () => {
  const markup = renderToStaticMarkup(<LoginPage /> as ReactElement);

  expect(markup).toContain('<main id="main-content" tabindex="-1">');
  expect(markup.match(/id="main-content"/g) ?? []).toHaveLength(1);
  expect(markup).toContain("<h1>Iniciar sesión</h1>");
});
