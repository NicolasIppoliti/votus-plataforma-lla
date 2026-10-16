import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionReferenceMap, revealExactResults } from "./SectionReferenceMap";
import { shareFill } from "./reference-colors";
import { REFERENCE_FILL, REFERENCE_LINE } from "./reference-colors";

it("preserves default standalone controls and supports externally controlled panels", () => {
  const props = { coordinates: [[[[-62, -38], [-61, -37], [-62, -38]]]], name: "Sección", label: "Oficial", resultId: "results", staticLabel: "Referencia" };
  const standalone = renderToStaticMarkup(<SectionReferenceMap {...props} />);
  expect(standalone).toContain("Mostrar mapa interactivo");
  expect(standalone).toContain("Mapa opcional:");
  const controlled = renderToStaticMarkup(<SectionReferenceMap {...props} active hideControls />);
  expect(controlled).not.toContain("Mostrar mapa interactivo");
  expect(controlled).not.toContain('role="img"');
  expect(controlled).toContain("Mapa geográfico CNE");
});

describe("fixed electoral fill domain", () => {
  it("interpolates the same endpoints and midpoint independently of the election", () => {
    expect(shareFill(0)).toEqual([103, 143, 162, 255]);
    expect(shareFill(50)).toEqual([102, 186, 202, 255]);
    expect(shareFill(100)).toEqual([101, 229, 242, 255]);
    expect(shareFill(50)).toEqual(shareFill(50));
  });

  it("brightens toward cyan as share grows, so high shares stay visible on the navy map stage", () => {
    const luminance = ([r, g, b]: readonly number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    expect(luminance(shareFill(100))).toBeGreaterThan(luminance(shareFill(50)));
    expect(luminance(shareFill(50))).toBeGreaterThan(luminance(shareFill(0)));
  });
});

describe("reference geography colors", () => {
  it("paints unfilled reference geography in the approved cyan", () => {
    expect(REFERENCE_FILL).toEqual([101, 229, 242, 40]);
    expect(REFERENCE_LINE).toEqual([101, 229, 242, 200]);
  });
});

describe("revealExactResults", () => {
  it("focuses the results heading and opens the folded exact table it promises", () => {
    const focused: string[] = [];
    const disclosure = { open: false };
    const doc = {
      getElementById: (id: string) => (id === "compare-results-heading" ? { focus: () => focused.push(id) } : null),
      querySelectorAll: (selector: string) => (selector === '[data-results-for="compare-results-heading"]' ? [disclosure] : []),
    };
    revealExactResults(doc, "compare-results-heading");
    expect(disclosure.open).toBe(true);
    expect(focused).toEqual(["compare-results-heading"]);
  });
});
