import { existsSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// #600: Next renders these by file convention (app/error.tsx wraps the
// authenticated layout; app/global-error.tsx replaces the root layout;
// app/not-found.tsx answers unknown routes). They must exist at those paths.
const SECRET = "relation workspace_private.organization does not exist (SQLSTATE 42P01)";

describe("recoverable boundaries above the authenticated layout (#600)", () => {
  it("lives at the Next convention paths", () => {
    for (const file of ["./error.tsx", "./global-error.tsx", "./not-found.tsx"]) expect(existsSync(new URL(file, import.meta.url))).toBe(true);
  });

  it("app error: Spanish recovery with retry and sign-in, never the error internals", async () => {
    const { default: AppError } = await import("./error");
    const reset = vi.fn();
    const html = renderToStaticMarkup(<AppError error={Object.assign(new Error(SECRET), { digest: "123abc" })} reset={reset} />);
    expect(html).toContain("No se pudo abrir el espacio de trabajo");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Reintentar<\/button>/);
    expect(html).toContain('href="/login"');
    expect(html).toContain("Volver a iniciar sesión");
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain("123abc");
  });

  it("global error: a standalone Spanish document with the same recovery", async () => {
    const { default: GlobalError } = await import("./global-error");
    const html = renderToStaticMarkup(<GlobalError error={Object.assign(new Error(SECRET), { digest: "123abc" })} reset={vi.fn()} />);
    expect(html).toMatch(/^<html lang="es">/);
    expect(html).toContain("<body");
    expect(html).toContain("No se pudo cargar Votus");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Reintentar<\/button>/);
    expect(html).toContain('href="/login"');
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain("123abc");
  });

  it("not found: Spanish page with a way back home, free of in-scope words", async () => {
    const { default: NotFound } = await import("./not-found");
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain("<h1>Página no encontrada</h1>");
    expect(html).toContain('href="/"');
    expect(html).toContain("Volver al inicio");
    // auth.spec.ts: the root not-found ships in every page payload, including
    // the anonymous login, so it must not carry in-scope words such as Panorama.
    expect(html).not.toContain("Panorama");
  });
});
