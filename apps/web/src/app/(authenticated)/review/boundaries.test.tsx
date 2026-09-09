import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Loading from "./loading";
import ReviewError from "./error";

describe("review route boundaries", () => {
  it("announces a generic technical error with an accessible retry and never reads error details", () => {
    const error = new Error("PRIVATE_REVIEW_PAYLOAD_SENTINEL");
    for (const key of ["message", "digest"]) {
      Object.defineProperty(error, key, { get() { throw new Error("Error detail was accessed"); } });
    }
    const markup = renderToStaticMarkup(<ReviewError error={error} unstable_retry={() => {}} />);
    expect(markup).toContain("<h1>Cola de revisión</h1>");
    expect(markup).toContain('role="alert" aria-labelledby="review-error-heading"');
    expect(markup).toContain('id="review-error-heading">No se pudo cargar la revisión</h2>');
    expect(markup).toContain("Revise la conexión y vuelva a intentar la carga.");
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*>Reintentar carga<\/button>/);
    expect(markup).not.toMatch(/disabled|PRIVATE_REVIEW|<table|<nav|Mostrando|elementos requieren revisión|Oculto por alcance/);
    expect(markup.replace(/<[^>]*>/g, "")).not.toMatch(/\d/);
  });
  it("reserves the review header and panels without presenting queue evidence", () => {
    const markup = renderToStaticMarkup(<Loading />);
    expect(markup).toContain('class="review-queue page-shell"');
    expect(markup).toContain('class="review-queue__header"');
    expect(markup).toContain("<h1>Cola de revisión</h1>");
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Cargando cola de revisión");
    expect(markup).toContain('class="review-queue__attention"');
    expect(markup).toContain('class="review-queue__results"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toMatch(/<table|<nav|Mostrando|elementos requieren revisión|Oculto por alcance|animate|pulse/);
    expect(markup.replace(/<[^>]*>/g, "")).not.toMatch(/\d/);
  });
});
