import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import LoginPage from "./page";

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

it("presents Votus identity and product purpose before the protected sign-in form", () => {
  const markup = renderToStaticMarkup(<LoginPage /> as ReactElement);

  expect(markup).toContain('class="login-brand"');
  expect(markup).toContain('class="login-brand__name">Votus</span>');
  expect(markup).toContain("Análisis electoral, con evidencia.");
  expect(markup).toContain("Resultados oficiales, comparación de elecciones y escenarios en un mismo espacio de trabajo.");
  expect(markup.indexOf('class="login-brand"')).toBeLessThan(markup.indexOf('id="login-heading"'));
  expect(markup).toContain("Acceso exclusivo para usuarios autorizados.");
  expect(markup).toContain('type="email"');
  expect(markup).toContain('type="password"');
});
