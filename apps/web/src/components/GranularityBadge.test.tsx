import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GranularityBadge } from "./GranularityBadge";

/**
 * provenance-display spec: "Visible granularity indicator on every
 * figure" — every figure carries a visible granularity indicator, and
 * degradation from a finer requested level MUST never be silent (design.md
 * D7: "Granularity degradation is NOT a queue item — it is a first-class
 * column on every result row and response, rendered as a badge").
 *
 * No DOM/testing-library dependency in this project — `renderToStaticMarkup`
 * is enough to assert on the rendered HTML string.
 */

describe("GranularityBadge", () => {
  it("test_mesa_indicator_and_degraded_indicator_shown", () => {
    const mesaHtml = renderToStaticMarkup(<GranularityBadge granularity="mesa" />);
    expect(mesaHtml).toContain("mesa");

    const degradedHtml = renderToStaticMarkup(
      <GranularityBadge granularity="distrito" degradedFrom="mesa" />,
    );
    expect(degradedHtml).toContain("distrito");
    // The degradation itself MUST be visible, not merely encoded in a prop
    // the markup ignores.
    expect(degradedHtml).toContain('aria-label="granularidad: distrito"');
    expect(degradedHtml.toLowerCase()).toContain("degrad");
    expect(degradedHtml).toContain("mesa");
  });

  it("shows the human level label, not the raw value (#453)", () => {
    const html = renderToStaticMarkup(<GranularityBadge granularity="seccion" requestedGranularity="mesa" />);
    expect(html).toContain('aria-label="granularidad: sección"');
    expect(html).toContain("<span>Sección</span>");
    expect(html).toContain("granularidad solicitada: mesa; granularidad real: sección");
  });

  it("does not show a degradation note when no degradation occurred", () => {
    const html = renderToStaticMarkup(<GranularityBadge granularity="mesa" />);
    expect(html.toLowerCase()).not.toContain("degrad");
  });
});
