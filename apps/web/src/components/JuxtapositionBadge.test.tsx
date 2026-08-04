import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JuxtapositionBadge } from "./JuxtapositionBadge";

/**
 * fiscalizacion-analysis spec, "The cross-election juxtaposition badge is
 * reachable and exercised" (Requirement 9) — previously untestable because
 * no route rendered a fiscalización figure at all (Phase 13). This test
 * covers the badge in isolation: both election identities and source kinds
 * MUST be visible, and the fiscalización figure's non-random coverage MUST
 * sit adjacent to it, not only in a page-level footnote (design.md D9.2 —
 * the 60,48 % LLA fiscalización figure must never be rendered beside the
 * 29,31 % 2023 municipal official figure without both badges attached).
 */

const FISCALIZACION_FIGURE = {
  electionId: "2025-legislativas-nacional",
  electionLabel: "26 Oct 2025 national legislative",
  sourceKind: "fiscalizacion" as const,
  sharePercent: 60.48,
  coverage: {
    observedUnits: 93,
    denominatorUnits: 153,
    denominatorBasis: "distinct mesa_id, distrito_id=02 seccion_id=027",
    isRandomSample: false as const,
  },
};

const OFFICIAL_FIGURE = {
  electionId: "2023-municipal-coronel-rosales",
  electionLabel: "2023 municipal",
  sourceKind: "official" as const,
  sharePercent: 29.31,
};

describe("JuxtapositionBadge", () => {
  it("test_cross_election_juxtaposition_shows_both_election_identities_and_source_kinds", () => {
    const html = renderToStaticMarkup(
      <JuxtapositionBadge fiscalizacion={FISCALIZACION_FIGURE} official={OFFICIAL_FIGURE} />,
    );

    expect(html).toContain(FISCALIZACION_FIGURE.electionLabel);
    expect(html).toContain(OFFICIAL_FIGURE.electionLabel);
    expect(html.toLowerCase()).toContain("unofficial");
    expect(html.toLowerCase()).toContain("official source");
  });

  it("test_non_random_coverage_is_stated_adjacent_not_only_in_a_footnote", () => {
    const html = renderToStaticMarkup(
      <JuxtapositionBadge fiscalizacion={FISCALIZACION_FIGURE} official={OFFICIAL_FIGURE} />,
    );

    expect(html.toLowerCase()).toContain("not a random sample");
    expect(html).toContain("93");
    expect(html).toContain("153");

    // Adjacency, not a page-level footnote: the coverage text must appear
    // BEFORE the official figure's own section closes, i.e. scoped to the
    // fiscalización figure's own markup rather than trailing the whole
    // component in one shared closing note.
    const coverageIndex = html.toLowerCase().indexOf("not a random sample");
    const officialSectionIndex = html.indexOf(OFFICIAL_FIGURE.electionLabel);
    expect(coverageIndex).toBeGreaterThan(-1);
    expect(coverageIndex).toBeLessThan(officialSectionIndex);

    // Never presented as a like-for-like comparison without disclosure.
    expect(html.toLowerCase()).toContain("not directly comparable");
  });
});
