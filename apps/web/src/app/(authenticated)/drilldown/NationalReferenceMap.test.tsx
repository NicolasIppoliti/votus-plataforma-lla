import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NationalReferenceMap } from "./NationalReferenceMap";

describe("national reference before activation", () => {
  it("does not evaluate the optional projection dependency before map activation", async () => {
    vi.resetModules();
    const evaluated = vi.fn();
    vi.doMock("d3-geo", () => { evaluated(); return {}; });
    try {
      const { NationalReferenceMap: FreshMap } = await import("./NationalReferenceMap");
      renderToStaticMarkup(<FreshMap />);
      expect(evaluated).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("d3-geo");
      vi.resetModules();
    }
  });
  it("offers actual orientation links and exact selectors without requiring WebGL or an applied selection", () => {
    const html = renderToStaticMarkup(<NationalReferenceMap />);
    expect(html).toContain("Mostrar referencia nacional");
    expect(html).toContain('href="#province-reference-heading"');
    expect(html).toContain('href="#explorer-election"');
    expect(html).not.toContain('name="distritoCode"');
    expect(html).not.toContain("resultados nacionales disponibles");
  });
});
