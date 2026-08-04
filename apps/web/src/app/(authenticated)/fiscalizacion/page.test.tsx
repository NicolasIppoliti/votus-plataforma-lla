import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ResultsRepository } from "@/lib/fiscalizacion/repository";
import type { ResultRow, RowSource } from "@/lib/fiscalizacion/repository";
import { FISCALIZACION_COVERAGE, loadFiscalizacionView, renderFiscalizacionView } from "./page";

/**
 * fiscalizacion-analysis spec, "An operator route reaches fiscalización
 * through the opt-in path" (Requirement 8) — this route was previously
 * complete and unreachable: no page called `repository.queryFiscalizacion()`
 * (Phase 13 preamble). These tests exercise the page's own data-loading and
 * rendering functions directly (RSC pages have no client-side DOM to mount),
 * matching the existing convention in `GranularityBadge.test.tsx` and
 * `repository.test.ts`'s `fakeRowSource` seam.
 */

function fakeRowSource(rows: ResultRow[]): RowSource {
  return { fetchRows: () => Promise.resolve(rows) };
}

const QUERY = { electionId: "2025-legislativas-nacional", jurisdictionId: "j-027", categoryId: "c-diputados" };

const FISCALIZACION_ROWS: ResultRow[] = [
  {
    jurisdictionId: "j-027",
    categoryId: "c-diputados",
    listId: "110",
    votes: 12578,
    sourceKind: "fiscalizacion",
    granularity: "mesa",
    archiveEntryId: "fiscalizacion/2025-lla",
  },
];

const OFFICIAL_ROWS: ResultRow[] = [
  {
    jurisdictionId: "j-027",
    categoryId: "c-diputados",
    listId: "110",
    votes: 100,
    sourceKind: "official",
    granularity: "mesa",
    archiveEntryId: "national/2025-legislativas",
  },
];

describe("fiscalizacion page — loadFiscalizacionView", () => {
  it("test_route_requests_fiscalizacion_through_the_opt_in_path", async () => {
    const repository = new ResultsRepository(fakeRowSource([...FISCALIZACION_ROWS, ...OFFICIAL_ROWS]));
    const queryFiscalizacionSpy = vi.spyOn(repository, "queryFiscalizacion");
    const queryOfficialSpy = vi.spyOn(repository, "queryOfficial");

    const view = await loadFiscalizacionView(repository, QUERY);

    expect(queryFiscalizacionSpy).toHaveBeenCalledWith(QUERY, {
      coverage: FISCALIZACION_COVERAGE,
    });
    expect(queryOfficialSpy).not.toHaveBeenCalled();
    expect(view.status).toBe("ok");
    if (view.status !== "ok") throw new Error("expected ok status");
    expect(view.rows.every((row) => row.sourceKind === "fiscalizacion")).toBe(true);
  });

  it("test_route_refuses_to_render_without_coverage", async () => {
    const repository = new ResultsRepository(fakeRowSource(FISCALIZACION_ROWS));
    const queryFiscalizacionSpy = vi.spyOn(repository, "queryFiscalizacion");

    const view = await loadFiscalizacionView(repository, QUERY, null);

    expect(view.status).toBe("refused");
    // No coverage at all must refuse WITHOUT even reaching the repository —
    // an unlabelled figure must never be reachable, not merely undisplayed.
    expect(queryFiscalizacionSpy).not.toHaveBeenCalled();
  });
});

describe("fiscalizacion page — renderFiscalizacionView", () => {
  it("test_every_fiscalizacion_figure_carries_unofficial_indicator_and_coverage", () => {
    const html = renderToStaticMarkup(
      renderFiscalizacionView({
        status: "ok",
        rows: FISCALIZACION_ROWS,
        coverage: FISCALIZACION_COVERAGE,
      }),
    );

    expect(html.toLowerCase()).toContain("unofficial");
    expect(html).toContain("93");
    expect(html).toContain("153");
  });

  it("test_coverage_indicator_states_it_is_not_a_random_sample", () => {
    const html = renderToStaticMarkup(
      renderFiscalizacionView({
        status: "ok",
        rows: FISCALIZACION_ROWS,
        coverage: FISCALIZACION_COVERAGE,
      }),
    );

    expect(html.toLowerCase()).toContain("not a random sample");
  });

  it("test_official_figure_inside_the_view_carries_its_own_official_indicator", () => {
    const html = renderToStaticMarkup(
      renderFiscalizacionView(
        { status: "ok", rows: FISCALIZACION_ROWS, coverage: FISCALIZACION_COVERAGE },
        {
          electionId: "2023-municipal-coronel-rosales",
          electionLabel: "2023 municipal",
          sourceKind: "official",
          sharePercent: 29.31,
        },
      ),
    );

    expect(html.toLowerCase()).toContain("official source");
    // Both source kinds must be visually distinguishable — the two labels
    // must be different strings, never the same badge text reused.
    const unofficialText = html.toLowerCase().match(/unofficial source/g) ?? [];
    const officialText = html.toLowerCase().match(/(?<!un)official source/g) ?? [];
    expect(unofficialText.length).toBeGreaterThan(0);
    expect(officialText.length).toBeGreaterThan(0);
  });

  it("renders the refusal state, not an unlabelled figure, when refused", () => {
    const html = renderToStaticMarkup(
      renderFiscalizacionView({ status: "refused", reason: "no coverage supplied" }),
    );

    expect(html.toLowerCase()).toContain("refus");
    expect(html).not.toContain("12578");
  });
});
