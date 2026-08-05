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
  partyName: "LA LIBERTAD AVANZA",
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
  // The SAME party as the fiscalización side: the badge compares one party
  // across two elections, never each election's own winner.
  partyName: "LA LIBERTAD AVANZA",
  sharePercent: 29.31,
};

const OFFICIAL_SOURCES = [
  {
    archiveEntryId: "national/2023-generales",
    sha256: "aaaabbbbccccdddd0000111122223333444455556666777788889999aaaabbbb",
    url: "https://example.test/2023-generales.zip",
    fetchedAt: "2026-01-01T00:00:00Z",
  },
];

describe("JuxtapositionBadge", () => {
  it("test_an_unknown_source_kind_is_labelled_unverified_not_rendered_bare", () => {
    // The `never` assignment catches a WIDENED union at compile time; this
    // branch exists for a value that escapes typing at runtime (an untyped
    // repository row), and nothing drove it.
    const html = renderToStaticMarkup(
      <JuxtapositionBadge
        fiscalizacion={FISCALIZACION_FIGURE}
        official={{ ...OFFICIAL_FIGURE, sourceKind: "encuesta" as never }}
        officialSources={OFFICIAL_SOURCES}
      />,
    );

    expect(html).toContain("UNVERIFIED source kind");
    // It must not borrow the official label it failed to earn.
    expect(html.match(/(?<!un)official source/g) ?? []).toHaveLength(0);
  });

  it("test_an_official_figure_with_no_sources_announces_it", () => {
    const html = renderToStaticMarkup(
      <JuxtapositionBadge
        fiscalizacion={FISCALIZACION_FIGURE}
        official={OFFICIAL_FIGURE}
        officialSources={[]}
      />,
    );

    expect(html).toContain("No archived source for this figure");
  });

  it("test_cross_election_juxtaposition_shows_both_election_identities_and_source_kinds", () => {
    const html = renderToStaticMarkup(
      <JuxtapositionBadge
        fiscalizacion={FISCALIZACION_FIGURE}
        official={OFFICIAL_FIGURE}
        officialSources={OFFICIAL_SOURCES}
      />,
    );

    expect(html).toContain(FISCALIZACION_FIGURE.electionLabel);
    expect(html).toContain(OFFICIAL_FIGURE.electionLabel);
    // `"unofficial source"` CONTAINS `"official source"`, so both assertions
    // used to pass off the fiscalización span alone: `sourceLabel` could
    // return "unofficial" unconditionally and this test stayed green, which is
    // the exact mislabel it exists to catch.
    expect(html.toLowerCase()).toContain("unofficial source");
    expect(html.toLowerCase().match(/(?<!un)official source/g) ?? []).toHaveLength(1);
  });

  it("test_non_random_coverage_is_stated_adjacent_not_only_in_a_footnote", () => {
    const html = renderToStaticMarkup(
      <JuxtapositionBadge
        fiscalizacion={FISCALIZACION_FIGURE}
        official={OFFICIAL_FIGURE}
        officialSources={OFFICIAL_SOURCES}
      />,
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
