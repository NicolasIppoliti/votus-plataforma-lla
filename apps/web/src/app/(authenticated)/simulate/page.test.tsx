import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SimulatePage from "./page";

/**
 * `composeCouncil` and `CouncilCompositionError` were complete, tested, and
 * called by nothing: the 18-seat roster the Concejo Deliberante actually has
 * could not be reached from any page. That is the ninth instance of the
 * failure AGENTS.md opens with.
 */

/** A PBA municipal race: 9 seats renewed, Hare quota by statute. */
const ALLOCATION_INPUT = {
  level: "pba_municipal",
  totalVotes: 10000,
  blankVotes: 0,
  annulledVotes: 0,
  unmodeledVotes: 0,
  unmodeledVoteBreakdown: [],
  seatsToFill: 9,
  isProjection: true,
  granularity: "mesa",
  lists: [
    { listId: "110", listName: "LA LIBERTAD AVANZA", votes: 6000 },
    { listId: "999", listName: "FUERZA PATRIA", votes: 4000 },
  ],
};

/** Nine held-over seats: the half NOT up for renewal this election. */
const HELD_OVER = Array.from({ length: 9 }, (_, index) => ({
  listId: index < 5 ? "999" : "110",
  listName: index < 5 ? "FUERZA PATRIA" : "LA LIBERTAD AVANZA",
}));

const OFFICIAL_PBA_2025_INPUT = {
  level: "pba_municipal",
  voteTotals: { kind: "valid_votes_only", validVotes: 32_291 },
  unmodeledVotes: 5_901,
  unmodeledVoteBreakdown: [
    { reason: "omitted_non_qualifying_lists", votes: 5_901 },
  ],
  seatsToFill: 9,
  councilTotal: 18,
  isProjection: true,
  granularity: "seccion",
  lists: [
    { listId: "lla", listName: "ALIANZA LA LIBERTAD AVANZA", votes: 14_550 },
    { listId: "fp", listName: "ALIANZA FUERZA PATRIA", votes: 7_300 },
    { listId: "potencia", listName: "ALIANZA POTENCIA", votes: 4_540 },
  ],
};

async function renderSimulation(input?: object): Promise<string> {
  return renderToStaticMarkup(
    (await SimulatePage({
      searchParams: Promise.resolve(
        input ? { input: JSON.stringify(input) } : {},
      ),
    })) as ReactElement,
  );
}

describe("simulate page — complete statutory evidence", () => {
  it("renders a published PBA vote scenario without relabelling it D’Hondt", async () => {
    const markup = await renderSimulation(OFFICIAL_PBA_2025_INPUT);

    expect(markup).toContain("Hare quota with largest remainder");
    expect(markup).toContain("Ley 5109 Arts. 109–110");
    expect(markup).not.toContain("D’Hondt");
    expect(markup).toContain("Valid-vote basis");
    expect(markup).toContain(
      "32,291 valid votes; total, blank, and annulled values were not reported",
    );
    expect(markup).toContain("5,901 explicitly unmodeled");
    expect(markup).toContain("Omitted non-qualifying lists: 5,901 votes");
    expect(markup).toContain("Seats being allocated");
    expect(markup).toContain("Hare cuociente");
    expect(markup).toMatch(/3,?587\.888888/);
    expect(markup).toContain("4.055309528970921");
    expect(markup).toContain("Initial quotient seats");
    expect(markup).toContain("Exact remainder");
    expect(markup).toContain("Seats by remainder");
    expect(markup).toMatch(/<caption>Hare allocation by list<\/caption>/);
    expect(markup).toMatch(/<caption>Per-seat award evidence<\/caption>/);
    expect(markup).toContain("largest_remainder");
    expect(markup).toContain("table-scroll");
  });

  it("keeps every evidence table in a labelled, focusable scroll region", async () => {
    const markup = await renderSimulation(OFFICIAL_PBA_2025_INPUT);

        expect(
          markup.match(
            /<table class="data-table data-table--allocation-[^"]+"/g,
          ),
        ).toHaveLength(2);
        expect(
          markup.match(
            /<table class="data-table data-table--allocation-wide"/g,
          ),
        ).toHaveLength(2);
        expect(markup).toContain(
          'class="allocation-column allocation-column--identity"',
        );
        expect(markup).toContain('class="table-cell--number">14,550</td>');
        expect(markup.match(/class="table-scroll"/g)).toHaveLength(2);
    expect(markup.match(/scope="col"/g)).toHaveLength(13);
    expect(markup).toMatch(
      /<div class="table-scroll" role="region" aria-label="Hare allocation by list" tabindex="0">/,
    );
    expect(markup).toMatch(
      /<div class="table-scroll" role="region" aria-label="Per-seat award evidence" tabindex="0">/,
    );
    expect(markup).not.toContain("overflow-x-auto");
    expect(markup).not.toContain("min-w-full");
  });

  it("renders combined blank-and-annulled evidence without inventing either category", async () => {
    const markup = await renderSimulation({
      level: "pba_municipal",
      voteTotals: {
        kind: "combined_blank_and_annulled",
        totalVotes: 39_273,
        combinedBlankAndAnnulledVotes: 3_914,
      },
      unmodeledVotes: 0,
      unmodeledVoteBreakdown: [],
      seatsToFill: 9,
      councilTotal: 18,
      isProjection: true,
      granularity: "seccion",
      lists: [{ listId: "A", listName: "Lista A", votes: 35_359 }],
    });

    expect(markup).toContain("3,914 combined blank and annulled");
    expect(markup).not.toContain("3,914 blank");
    expect(markup).not.toContain("3,914 annulled");
  });

  it("renders halving iterations and statutory tie evidence", async () => {
    const halving = await renderSimulation({
      level: "pba_provincial",
      totalVotes: 400,
      blankVotes: 0,
      annulledVotes: 0,
      unmodeledVotes: 0,
      unmodeledVoteBreakdown: [],
      seatsToFill: 4,
      isProjection: true,
      granularity: "seccion",
      lists: [
        { listId: "A", listName: "Lista A", votes: 40 },
        { listId: "B", listName: "Lista B", votes: 30 },
        { listId: "C", listName: "Lista C", votes: 20 },
      ],
    });
    expect(halving).toMatch(/<caption>Hare halving trace<\/caption>/);
    expect(halving).toContain("Initial cuociente");
    expect(halving).toContain("Iteration 1");
    expect(halving).toContain("Iteration 2");

    const tied = await renderSimulation({
      level: "pba_provincial",
      totalVotes: 40,
      blankVotes: 0,
      annulledVotes: 0,
      unmodeledVotes: 2,
      unmodeledVoteBreakdown: [
        { reason: "other_source_rows", votes: 2 },
      ],
      seatsToFill: 4,
      isProjection: true,
      granularity: "seccion",
      lists: [
        { listId: "P", listName: "Lista P", votes: 24 },
        { listId: "Q", listName: "Lista Q", votes: 14 },
      ],
    });
    expect(tied).toContain("Equal remainder resolved by higher raw vote total");
    expect(tied).toContain("statutory");
    expect(tied).toContain("Ley 5109 Art. 109(c)");
  });

  it("renders national threshold exclusions, full quotient tables, ordered winners, and ties", async () => {
    const markup = await renderSimulation({
      level: "national",
      padron: 100_000,
      totalVotes: 16_000,
      unmodeledVotes: 0,
      unmodeledVoteBreakdown: [],
      threshold: { value: 3, basis: "padron" },
      seatsToFill: 2,
      isProjection: true,
      granularity: "distrito",
      lists: [
        { listId: "A", listName: "Lista A", votes: 10_000 },
        { listId: "B", listName: "Lista B", votes: 4_000 },
        { listId: "C", listName: "Lista C", votes: 2_000 },
      ],
    });

    expect(markup).toContain("D’Hondt");
    expect(markup).toContain("Ley 19.945 Arts. 160–161");
    expect(markup).not.toContain("Ley 5109");
    expect(markup).toContain("Scenario policy threshold basis");
    expect(markup).toContain("3% of padrón 100,000 = 3,000 votes");
    expect(markup).toContain("Lista C");
    expect(markup).toContain("excluded: 2,000 votes are below 3,000");
        expect(markup).toMatch(/<caption>D’Hondt quotient table<\/caption>/);
        expect(markup).toMatch(
          /<table class="data-table data-table--allocation-standard">/,
        );
        expect(markup).toMatch(
          /<table class="data-table data-table--allocation-compact">/,
        );
        expect(markup).toContain("Divisor 1");
    expect(markup).toContain("Divisor 2");
    expect(markup).toMatch(/<caption>Ordered winning quotients<\/caption>/);
    expect(markup).toContain("Seat 1");
    expect(markup).toContain("Seat 2");

    const tied = await renderSimulation({
      level: "national",
      padron: 1_000,
      totalVotes: 200,
      unmodeledVotes: 0,
      unmodeledVoteBreakdown: [],
      threshold: { value: 0, basis: "padron" },
      seatsToFill: 1,
      isProjection: true,
      granularity: "distrito",
      lists: [
        { listId: "A", listName: "Lista A", votes: 100 },
        { listId: "B", listName: "Lista B", votes: 100 },
      ],
    });
    expect(tied).toContain(
      "Equal quotient and equal vote total resolved by lower list id",
    );
    expect(tied).toContain("simulation_convention");
    expect(tied).toContain("sorteo");
  });

  it("renders explicit diagnostics for absent, invalid, and insufficient scenarios", async () => {
    const absent = await renderSimulation();
    expect(absent).toContain("No simulation run");

    const invalid = await renderSimulation({
      ...OFFICIAL_PBA_2025_INPUT,
      lists: [],
    });
    expect(invalid).toContain("not a valid projection input");
    expect(invalid).not.toContain("Hare allocation by list");

    const insufficient = await renderSimulation({
      level: "national",
      padron: 100_000,
      totalVotes: 1_000,
      unmodeledVotes: 0,
      unmodeledVoteBreakdown: [],
      threshold: { value: 3, basis: "padron" },
      seatsToFill: 2,
      isProjection: true,
      granularity: "distrito",
      lists: [{ listId: "A", listName: "Lista A", votes: 1_000 }],
    });
    expect(insufficient).toContain("no positive-vote list clears");
    expect(insufficient).not.toContain("Ordered winning quotients");
  });

  it("renders projection coverage gaps and refuses incomplete historical output", async () => {
    const projection = await renderSimulation({
      level: "pba_provincial",
      totalVotes: 100,
      blankVotes: 0,
      annulledVotes: 0,
      unmodeledVotes: 0,
      unmodeledVoteBreakdown: [],
      seatsToFill: 2,
      isProjection: true,
      granularity: "seccion",
      lists: [{ listId: "A", listName: "Lista A", votes: 90 }],
    });
    expect(projection).toContain("Incomplete vote coverage: 10");
    expect(projection).toContain(
      "scenario input, not official historical evidence",
    );

    const historical = await renderSimulation({
      level: "pba_provincial",
      totalVotes: 100,
      blankVotes: 0,
      annulledVotes: 0,
      unmodeledVotes: 0,
      unmodeledVoteBreakdown: [],
      seatsToFill: 2,
      isProjection: false,
      granularity: "seccion",
      lists: [{ listId: "A", listName: "Lista A", votes: 90 }],
    });
    expect(historical).toContain("Historical simulation is unavailable at this route");
    expect(historical).not.toContain("Hare allocation by list");
  });
});

describe("simulate page — the council roster is reachable", () => {
  it("test_the_full_council_renders_when_held_over_seats_are_supplied", async () => {
    const markup = renderToStaticMarkup(
      (await SimulatePage({
        searchParams: Promise.resolve({
          council: "Coronel de Marina Leonardo Rosales",
          input: JSON.stringify(ALLOCATION_INPUT),
          heldOver: JSON.stringify(HELD_OVER),
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("council-composition");
    // The NAME, never the bare list id: a roster of `110` reads as a
    // councillor called 110.
    expect(markup).toContain("LA LIBERTAD AVANZA");
    // The RENDERED HEADING. `toContain("9")` matches any digit 9 anywhere —
    // a vote total, list `999` — so it could not fail, on the very assertion
    // that is supposed to keep the two statutory quantities apart.
    expect(markup).toContain("18 seats, 9 renewed this election");
    expect(markup).toContain("held over, caller-supplied projection input");
  });

  it("test_a_wrong_held_over_count_is_refused_not_padded", async () => {
    const markup = renderToStaticMarkup(
      (await SimulatePage({
        searchParams: Promise.resolve({
          council: "Coronel de Marina Leonardo Rosales",
          input: JSON.stringify(ALLOCATION_INPUT),
          heldOver: JSON.stringify(HELD_OVER.slice(0, 3)),
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("expected councilTotal - seatsUpForRenewal");
    expect(markup).not.toContain("council-composition");
    expect(markup).not.toContain("allocation-result");
    expect(markup).not.toContain("Supplied-input trace");
    expect(markup).not.toContain("Projection (hypothetical");
  });

  it("test_without_held_over_seats_the_page_says_why_there_is_no_roster", async () => {
    const markup = renderToStaticMarkup(
      (await SimulatePage({
        searchParams: Promise.resolve({
          council: "Coronel de Marina Leonardo Rosales",
          input: JSON.stringify(ALLOCATION_INPUT),
        }),
      })) as ReactElement,
    );

    // Ley 5109 Art. 121 resolves which sitting councillors leave by sorteo —
    // a different question this system does not answer, so the held-over half
    // is caller-supplied projection input. Absent it, say so rather than
    // showing 9 as if it were the council.
    expect(markup).toContain("heldOver");
    expect(markup).not.toContain("council-composition");
  });
});

describe("simulate page — the roster belongs to one statute", () => {
  it("test_a_national_allocation_gets_no_council_roster", async () => {
    // 18 seats is LOM Art. 2 for a PBA partido. A national race elects no
    // municipal council, so composing one from its allocation attaches a
    // roster to a body the election does not fill.
    const markup = renderToStaticMarkup(
      (await SimulatePage({
        searchParams: Promise.resolve({
          council: "Coronel de Marina Leonardo Rosales",
          input: JSON.stringify({
            level: "national",
            seatsToFill: 9,
            padron: 20000,
            totalVotes: 10000,
            unmodeledVotes: 0,
            unmodeledVoteBreakdown: [],
            threshold: { value: 3, basis: "padron" },
            isProjection: true,
            granularity: "distrito",
            lists: [
              { listId: "110", listName: "LA LIBERTAD AVANZA", votes: 6000 },
              { listId: "999", listName: "FUERZA PATRIA", votes: 4000 },
            ],
          }),
          heldOver: JSON.stringify(HELD_OVER),
        }),
      })) as ReactElement,
    );

    // The message now names the PARTIDO too: the seat counts are Coronel
    // Rosales's, not every PBA municipality's.
    expect(markup).toContain("available only for pba_municipal projections");
    expect(markup).not.toContain("council-composition");
    expect(markup).not.toContain("allocation-result");
    expect(markup).not.toContain("Supplied-input trace");
  });

  it("refuses an unsupported council even when no held-over roster is supplied", async () => {
    const markup = renderToStaticMarkup(
      (await SimulatePage({
        searchParams: Promise.resolve({
          council: "Unsupported council",
          input: JSON.stringify(ALLOCATION_INPUT),
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("unsupported council");
    expect(markup).not.toContain("allocation-result");
    expect(markup).not.toContain("Supplied-input trace");
  });

  it("refuses held-over seats without a council before allocation or trace", async () => {
    const markup = renderToStaticMarkup(
      (await SimulatePage({
        searchParams: Promise.resolve({
          input: JSON.stringify(ALLOCATION_INPUT),
          heldOver: JSON.stringify(HELD_OVER),
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("heldOver requires a supported council");
    expect(markup.match(/role="alert"/g)).toHaveLength(1);
    expect(markup).not.toContain("allocation-result");
    expect(markup).not.toContain("Supplied-input trace");
    expect(markup).not.toContain("Projection (hypothetical");
    expect(markup).not.toContain("<p>Historical run</p>");
  });
});

describe("simulate page — the request cannot move the statute", () => {
  it("test_a_non_statutory_seat_count_is_refused_without_heldover_too", async () => {
    // The case an operator actually hits. The check sat inside the `heldOver`
    // branch, so omitting an unrelated query param rendered 17 awards for a
    // council that renews 9.
    const markup = renderToStaticMarkup(
      (await SimulatePage({
        searchParams: Promise.resolve({
          council: "Coronel de Marina Leonardo Rosales",
          input: JSON.stringify({ ...ALLOCATION_INPUT, seatsToFill: 17 }),
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("renews 9 of the 18 council seats");
    expect(markup).not.toContain("allocation-result");
    expect(markup).not.toContain("Supplied-input trace");
    expect(markup).not.toContain("Projection (hypothetical");
  });

  it("test_a_non_statutory_seat_count_is_refused", async () => {
    // `seatsToFill` arrives from the same untrusted channel `heldOver` does.
    // Taking it as the half-renewal divisor let a request compose an 18-seat
    // council with 17 renewed.
    const markup = renderToStaticMarkup(
      (await SimulatePage({
        searchParams: Promise.resolve({
          council: "Coronel de Marina Leonardo Rosales",
          input: JSON.stringify({ ...ALLOCATION_INPUT, seatsToFill: 17 }),
          heldOver: JSON.stringify(HELD_OVER.slice(0, 1)),
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("renews 9 of the 18 council seats");
    expect(markup).not.toContain("council-composition");
  });

  it("test_a_malformed_input_is_refused_with_a_stated_reason", async () => {
    // `?input={}` used to reach `input.lists` and surface a TypeError string
    // as a council error instead of a parse refusal.
    const markup = renderToStaticMarkup(
      (await SimulatePage({
        searchParams: Promise.resolve({
          council: "Coronel de Marina Leonardo Rosales",
          input: "{}",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("not a valid projection input");
    expect(markup).not.toContain("council-composition");
  });

  it("test_invalid_json_is_refused_as_json_not_as_a_schema_error", async () => {
    const markup = renderToStaticMarkup(
      (await SimulatePage({
        searchParams: Promise.resolve({
          council: "Coronel de Marina Leonardo Rosales",
          input: "{not json",
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("invalid JSON");
  });
});

describe("simulate page — a repeated query param reaches the guard", () => {
  it("test_a_repeated_query_param_is_reported_not_treated_as_absent", async () => {
    // Next.js hands `string[]` for a repeated param, and `stringParam`
    // returned `undefined` for those — so a SUPPLIED value vanished and the
    // page asked for a parameter the request had sent twice. The unit test in
    // `query-params.test.ts` is not evidence this page reaches the guard.
    const markup = renderToStaticMarkup(
      (await SimulatePage({
        searchParams: Promise.resolve({
          council: "Coronel de Marina Leonardo Rosales",
          input: [JSON.stringify(ALLOCATION_INPUT), "{}"],
        }),
      })) as ReactElement,
    );

    // "input" alone appears in prose all over this page; the assertion has to
    // name the guard's own sentence or it cannot fail.
    expect(markup).toContain("supplied more than once");
    expect(markup).toMatch(/cannot be resolved to one value: [^<]*input/);
  });
});

describe("simulate page — the statutory gate's own boundary", () => {
  it("test_without_a_named_council_the_allocation_makes_no_council_claim", async () => {
    // The gate keys on `?council=` because this route knows the 18/9 counts for
    // ONE partido. Absent that parameter a `pba_municipal` allocation still
    // renders — deliberately, because nothing has claimed a council — so the
    // contract is that no roster, no seat count and no statutory sentence
    // appear beside it. Untested, this read as either a hole or a feature.
    const markup = renderToStaticMarkup(
      (await SimulatePage({
        searchParams: Promise.resolve({
          input: JSON.stringify({ ...ALLOCATION_INPUT, seatsToFill: 17 }),
        }),
      })) as ReactElement,
    );

    expect(markup).toContain("allocation-result");
    // No council is claimed, so neither statutory quantity is asserted.
    expect(markup).not.toContain("council-composition");
    expect(markup).not.toContain("renews 9 of the 18 council seats");
  });

  it("test_positive_mayoria_is_refused_before_authoritative_seats_render", async () => {
    const markup = renderToStaticMarkup(
      (await SimulatePage({
        searchParams: Promise.resolve({
          input: JSON.stringify({ ...ALLOCATION_INPUT, mayoriaVotes: 1 }),
        }),
      })) as ReactElement,
    );

    expect(markup).toMatch(/MAYORIA.*not implemented.*Ley 5109/i);
    expect(markup).not.toContain("allocation-result");
  });
});

describe("simulate page — projection provenance boundary", () => {
  const projection = {
    ...ALLOCATION_INPUT,
    isProjection: true,
    granularity: "mesa",
  };

  async function renderCouncilProjection(heldOver: unknown): Promise<string> {
    return renderToStaticMarkup(
      (await SimulatePage({
        searchParams: Promise.resolve({
          council: "Coronel de Marina Leonardo Rosales",
          input: JSON.stringify(projection),
          heldOver: JSON.stringify(heldOver),
        }),
      })) as ReactElement,
    );
  }

  function traceFrom(markup: string): string | undefined {
    return markup.match(
      /Supplied-input trace \(not archive provenance\): sha256 ([a-f0-9]{64})/,
    )?.[1];
  }

  it("refuses caller-supplied historical status and source references", async () => {
    const markup = await renderSimulation({
      ...projection,
      isProjection: false,
      archiveEntryId: "forged-archive-entry",
      sha256: "f".repeat(64),
      sourceUrl: "https://forged.invalid/results.csv",
      fetchedAt: "2026-01-01T00:00:00Z",
    });

    expect(markup).toContain("Historical simulation is unavailable at this route");
    expect(markup).not.toContain("allocation-result");
    expect(markup).not.toContain("<p>Historical run</p>");
    expect(markup).not.toContain("forged-archive-entry");
    expect(markup).not.toContain("forged.invalid");
    expect(markup).not.toContain("f".repeat(64));
  });

  it("rejects forged archive fields on an otherwise valid projection", async () => {
    const markup = await renderSimulation({
      ...projection,
      archiveEntryId: "projection-cannot-cite-this",
      sha256: "a".repeat(64),
    });

    expect(markup).toContain("not a valid projection input");
    expect(markup).not.toContain("allocation-result");
    expect(markup).not.toContain("projection-cannot-cite-this");
    expect(markup).not.toContain("a".repeat(64));
    expect(markup).not.toContain('aria-label="provenance"');
  });

  it("requires and renders normalized projection granularity", async () => {
    const missingGranularity = { ...ALLOCATION_INPUT };
    Reflect.deleteProperty(missingGranularity, "granularity");
    const missing = await renderSimulation(missingGranularity);
    expect(missing).toContain("not a valid projection input");
    expect(missing).not.toContain("allocation-result");

    const unnormalized = await renderSimulation({
      ...projection,
      granularity: "precinct",
    });
    expect(unnormalized).toContain("not a valid projection input");
    expect(unnormalized).not.toContain("allocation-result");

    const markup = await renderSimulation(projection);
    expect(markup).toContain("Projection (hypothetical, caller supplied)");
    expect(markup).toContain("Input granularity");
    expect(markup).toContain('aria-label="granularity: mesa"');
  });

  it("renders a canonical supplied-input trace that is stable only for equivalent input", async () => {
    const reordered = {
      granularity: "mesa",
      lists: projection.lists.map(({ listId, listName, votes }) => ({
        votes,
        listName,
        listId,
      })),
      isProjection: true,
      seatsToFill: projection.seatsToFill,
      unmodeledVotes: projection.unmodeledVotes,
      unmodeledVoteBreakdown: projection.unmodeledVoteBreakdown,
      annulledVotes: projection.annulledVotes,
      blankVotes: projection.blankVotes,
      totalVotes: projection.totalVotes,
      level: projection.level,
    };
    const changed = {
      ...projection,
      lists: projection.lists.map((list, index) =>
        index === 0 ? { ...list, votes: list.votes + 1 } : list,
      ),
    };

    const firstMarkup = await renderSimulation(projection);
    const reorderedMarkup = await renderSimulation(reordered);
    const changedMarkup = await renderSimulation(changed);
    const councilMarkup = await renderCouncilProjection(HELD_OVER);
    const changedHeldOverMarkup = await renderCouncilProjection([
      { ...HELD_OVER[0], listId: "changed-held-over" },
      ...HELD_OVER.slice(1),
    ]);
    const trace = /Supplied-input trace \(not archive provenance\): sha256 ([a-f0-9]{64})/;
    const firstDigest = firstMarkup.match(trace)?.[1];
    const reorderedDigest = reorderedMarkup.match(trace)?.[1];
    const changedDigest = changedMarkup.match(trace)?.[1];
    const councilDigest = councilMarkup.match(trace)?.[1];
    const changedHeldOverDigest = changedHeldOverMarkup.match(trace)?.[1];

    expect(firstDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(reorderedDigest).toBe(firstDigest);
    expect(changedDigest).not.toBe(firstDigest);
    expect(changedHeldOverDigest).not.toBe(councilDigest);
  });

  it("rejects unknown held-over keys before allocation or trace generation", async () => {
    const markup = await renderCouncilProjection([
      { ...HELD_OVER[0], untrusted: "must-not-be-stripped" },
      ...HELD_OVER.slice(1),
    ]);

    expect(markup).toContain("not a valid heldOver roster");
    expect(markup).not.toContain("allocation-result");
    expect(markup).not.toContain("Supplied-input trace");
  });

  it("rejects malformed held-over values before allocation or trace generation", async () => {
    const markup = await renderCouncilProjection([
      { ...HELD_OVER[0], listName: 7 },
      ...HELD_OVER.slice(1),
    ]);

    expect(markup).toContain("not a valid heldOver roster");
    expect(markup).not.toContain("allocation-result");
    expect(markup).not.toContain("Supplied-input trace");
  });

  it("canonicalizes equivalent validated held-over rosters", async () => {
    const reordered = HELD_OVER.map(({ listId, listName }) => ({
      listName,
      listId,
    }));

    const originalDigest = traceFrom(await renderCouncilProjection(HELD_OVER));
    const reorderedDigest = traceFrom(await renderCouncilProjection(reordered));

    expect(originalDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(reorderedDigest).toBe(originalDigest);
  });

  it("changes the trace for a meaningful validated held-over change", async () => {
    const changed = [
      { ...HELD_OVER[0], listId: "changed-held-over" },
      ...HELD_OVER.slice(1),
    ];

    const originalDigest = traceFrom(await renderCouncilProjection(HELD_OVER));
    const changedDigest = traceFrom(await renderCouncilProjection(changed));

    expect(changedDigest).not.toBe(originalDigest);
  });
});
