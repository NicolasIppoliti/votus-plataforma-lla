import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import LoginPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

it("renders the login page as the public skip destination", () => {
  const markup = renderToStaticMarkup(<LoginPage /> as ReactElement);

  expect(markup).toContain(
    '<main id="main-content" class="login-page" tabindex="-1">',
  );
  expect(markup.match(/id="main-content"/g) ?? []).toHaveLength(1);
  expect(markup).toContain("Iniciar sesión</h1>");
});

it("groups the login form with its heading and supporting guidance", () => {
  const markup = renderToStaticMarkup(<LoginPage /> as ReactElement);

  expect(markup).toContain(
    '<section class="panel login-card" aria-labelledby="login-heading">',
  );
  expect(markup).toContain('<h1 id="login-heading">Iniciar sesión</h1>');
  expect(markup).toContain(
    '<p class="panel__copy">Accede con tus credenciales para continuar.</p>',
  );
  expect(markup).toContain(
    '<form aria-labelledby="login-heading" class="login-form">',
  );
});
