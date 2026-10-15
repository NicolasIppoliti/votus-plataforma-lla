import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NationalReferenceMap } from "./NationalReferenceMap";
import { TerritorialMapStage } from "./TerritorialMapStage";
import { MAP_HEADING } from "./map-heading";

describe("national reference before activation", () => {
  it("keeps one navigation anchor in the complete national reference region", () => {
    // Match provenance.spec.ts's nationalReferenceStage locator, not just the inner map.
    const html = renderToStaticMarkup(
      <TerritorialMapStage heading={MAP_HEADING.REFERENCE} title="Argentina" subtitle="Referencia geográfica">
        <NationalReferenceMap />
      </TerritorialMapStage>,
    );
    expect(html).toContain('aria-label="Mapa territorial de referencia"');
    expect(html.match(/<a\b[^>]*>/g)).toEqual([
      '<a href="#explorer-election">',
    ]);
    const disclosure = html.match(/<details>[\s\S]*?<\/details>/)?.[0];
    expect(disclosure).toBeDefined();
    expect(disclosure).not.toMatch(/<a\b/);
    expect(html).not.toContain('href="#official-evidence-heading"');
  });
  it("isolates the national document from stage decoration at fractional canvas edges", () => {
    const css = readFileSync(new URL("./drilldown.module.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.nationalMap\s*\{[^}]*background:\s*var\(--surface-muted\)/);
    expect(css).toMatch(/\.mapStage:has\(\.nationalMap\)\s*>\s*:is\([^)]*\.territoryLabel[^)]*\)\s*\{\s*display:\s*none/);
  });
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
  it("offers one exact selection action and disclosed provenance without requiring WebGL or an applied selection", () => {
    const html = renderToStaticMarkup(<NationalReferenceMap />);
    expect(html).toContain("Mostrar referencia nacional");
    expect(html).not.toContain('href="#province-reference-heading"');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toMatch(/<details><summary>Procedencia de la referencia nacional<\/summary>[\s\S]*?sha256/);
    expect(html.replace(/<details>[\s\S]*?<\/details>/g, "")).not.toMatch(/[a-f0-9]{64}/);
    expect(html).toContain('href="#explorer-election"');
    expect(html).not.toContain('name="distritoCode"');
    expect(html).not.toContain("resultados nacionales disponibles");
  });
});
