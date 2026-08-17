import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProvenanceLink } from "./ProvenanceLink";
import type { SourceRef } from "@/lib/results/types";

/**
 * provenance-display spec: "Every displayed figure is traceable to its
 * archived source" — archive entry id, sha256, source URL, and fetch
 * timestamp for a single-source figure; ALL contributing sources for a
 * derived figure (e.g. a 2023-vs-2025 swing).
 */

const SOURCE_2023: SourceRef = {
  archiveEntryId: "national/2023-generales",
  sha256: "a1b2c3d4e5f60000000000000000000000000000000000000000000000001a1b",
  url: "https://www.juntaelectoral.gba.gov.ar/resultados-generales/2023027.pdf",
  fetchedAt: "2026-01-01T00:00:00.000Z",
};

const SOURCE_2025: SourceRef = {
  archiveEntryId: "national/2025-legislativas",
  sha256: "b1b2c3d4e5f60000000000000000000000000000000000000000000000002b1b",
  url: "https://www.juntaelectoral.gba.gov.ar/resultados-generales/2025027.pdf",
  fetchedAt: "2026-01-02T00:00:00.000Z",
};

describe("ProvenanceLink", () => {
  it("test_traces_figure_to_archive_entry_sha256_url_timestamp", () => {
    const html = renderToStaticMarkup(<ProvenanceLink sources={[SOURCE_2023]} />);

    expect(html).toContain(SOURCE_2023.archiveEntryId);
    expect(html).toContain(SOURCE_2023.sha256);
    expect(html).toContain(SOURCE_2023.url);
    expect(html).toContain(SOURCE_2023.fetchedAt);
  });

  it("test_swing_figure_lists_both_contributing_sources", () => {
    const html = renderToStaticMarkup(
      <ProvenanceLink sources={[SOURCE_2023, SOURCE_2025]} />,
    );

    expect(html).toContain(SOURCE_2023.archiveEntryId);
    expect(html).toContain(SOURCE_2023.sha256);
    expect(html).toContain(SOURCE_2025.archiveEntryId);
    expect(html).toContain(SOURCE_2025.sha256);
  });
});

describe("ProvenanceLink — an entry with no hash", () => {
  it("test_an_entry_without_a_hash_is_named_unverifiable", () => {
    const html = renderToStaticMarkup(
      <ProvenanceLink
        sources={[
          {
            archiveEntryId: "national/2025-legislativas",
            sha256: null,
            url: "https://example.test/x.zip",
            fetchedAt: "2026-01-01T00:00:00Z",
          },
        ]}
      />,
    );

    expect(html).toContain("no puede verificarse");
  });
});
