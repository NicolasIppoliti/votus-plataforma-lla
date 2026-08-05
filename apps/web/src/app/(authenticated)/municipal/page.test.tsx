import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ResultsRepository } from "@/lib/fiscalizacion/repository";
import type { PartyNameSource, ResultRow, RowSource } from "@/lib/fiscalizacion/repository";
import { MUNICIPAL_PARTY_CONTEXT, loadMunicipalView, renderMunicipalView } from "./page";

/**
 * Phase 16c: `curated/party_map.yaml`'s `coronel_rosales_municipal`
 * mappings (list 2206 = the LLA+PRO alliance, Phase 15) were loaded but
 * unreachable — no route ever called `repository.queryOfficial` with the
 * municipal `PartyMappingContext`. This is this project's 8th instance of
 * shipped-correct, tested, unreachable code.
 *
 * Reads ONLY through `ResultsRepository.queryOfficial` — never a second
 * query path that could bypass the `source_kind = 'official'` default
 * (D9.1 threat-matrix control).
 */

function fakeRowSource(rows: ResultRow[]): RowSource {
  return { fetchRows: () => Promise.resolve(rows) };
}

function fakePartyNameSource(namesByListId: Record<string, string>): PartyNameSource {
  return {
    fetchPartyNames: (_context, listIds) => {
      const resolved = new Map<string, string>();
      for (const listId of listIds) {
        const name = namesByListId[listId];
        if (name) resolved.set(listId, name);
      }
      return Promise.resolve(resolved);
    },
  };
}

const QUERY = {
  electionId: "2025-legislativas-municipal",
  jurisdictionId: "j-027",
  categoryId: "c-concejales",
};

const MUNICIPAL_ROWS: ResultRow[] = [
  {
    jurisdictionId: "j-027",
    categoryId: "c-concejales",
    listId: "2206",
    votes: 4200,
    sourceKind: "official",
    // The PBA municipal source publishes DISTRITO totals, never mesa.
    granularity: "distrito",
    archiveEntryId: "pba/2025-municipal-coronel-rosales",
  },
];

describe("municipal page — loadMunicipalView", () => {
  it("test_route_renders_pba_municipal_results_with_resolved_party_names", async () => {
    const repository = new ResultsRepository(
      fakeRowSource(MUNICIPAL_ROWS),
      fakePartyNameSource({ "2206": "ALIANZA LA LIBERTAD AVANZA" }),
    );
    const queryOfficialSpy = vi.spyOn(repository, "queryOfficial");

    const view = await loadMunicipalView(repository, QUERY);

    expect(queryOfficialSpy).toHaveBeenCalledWith(QUERY, MUNICIPAL_PARTY_CONTEXT);
    expect(view.status).toBe("ok");
    if (view.status !== "ok") throw new Error("expected ok status");
    expect(view.rows[0]?.partyName).toBe("ALIANZA LA LIBERTAD AVANZA");

    const html = renderToStaticMarkup(renderMunicipalView(view));
    expect(html).toContain("ALIANZA LA LIBERTAD AVANZA");
  });
});

describe("municipal page — renderMunicipalView", () => {
  it("test_distrito_granularity_is_labelled_never_presented_as_mesa", () => {
    const html = renderToStaticMarkup(
      renderMunicipalView({
        status: "ok",
        rows: [{ ...MUNICIPAL_ROWS[0]!, partyName: "ALIANZA LA LIBERTAD AVANZA" }],
      }),
    );

    expect(html).toContain('granularity: distrito');
    expect(html).not.toContain('granularity: mesa');
    // provenance-display spec: a degraded-granularity figure MUST visibly
    // note it, never silently present a distrito total as if it were a
    // finer-grained (mesa) figure.
    expect(html.toLowerCase()).toContain("degraded from mesa");
  });
});
