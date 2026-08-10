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
  seatsToFill: 9,
  isProjection: false,
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
  totalVotes: 32_291,
  blankVotes: 0,
  annulledVotes: 0,
  unmodeledVotes: 5_901,
  seatsToFill: 9,
  councilTotal: 18,
  isProjection: false,
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
  it("renders the official PBA Hare computation without relabelling it D’Hondt", async () => {
    const markup = await renderSimulation(OFFICIAL_PBA_2025_INPUT);

    expect(markup).toContain("Hare quota with largest remainder");
    expect(markup).toContain("Ley 5109 Arts. 109–110");
    expect(markup).not.toContain("D’Hondt");
    expect(markup).toContain("Valid-vote basis");
    expect(markup).toContain("5,901 explicitly unmodeled");
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
    expect(markup).toContain("overflow-x-auto");
  });

  it("renders halving iterations and statutory tie evidence", async () => {
    const halving = await renderSimulation({
      level: "pba_provincial",
      totalVotes: 400,
      blankVotes: 0,
      annulledVotes: 0,
      unmodeledVotes: 0,
      seatsToFill: 4,
      isProjection: true,
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
      seatsToFill: 4,
      isProjection: false,
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
      threshold: { value: 3, basis: "padron" },
      seatsToFill: 2,
      isProjection: false,
      lists: [
        { listId: "A", listName: "Lista A", votes: 10_000 },
        { listId: "B", listName: "Lista B", votes: 4_000 },
        { listId: "C", listName: "Lista C", votes: 2_000 },
      ],
    });

    expect(markup).toContain("D’Hondt");
    expect(markup).toContain("Ley 19.945 Arts. 160–161");
    expect(markup).not.toContain("Ley 5109");
    expect(markup).toContain("Statutory threshold basis");
    expect(markup).toContain("3% of padrón 100,000 = 3,000 votes");
    expect(markup).toContain("Lista C");
    expect(markup).toContain("excluded: 2,000 votes are below 3,000");
    expect(markup).toMatch(/<caption>D’Hondt quotient table<\/caption>/);
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
      threshold: { value: 0, basis: "padron" },
      seatsToFill: 1,
      isProjection: true,
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
    expect(invalid).toContain("not a valid AllocationInput");
    expect(invalid).not.toContain("Hare allocation by list");

    const insufficient = await renderSimulation({
      level: "national",
      padron: 100_000,
      totalVotes: 1_000,
      unmodeledVotes: 0,
      threshold: { value: 3, basis: "padron" },
      seatsToFill: 2,
      isProjection: false,
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
      seatsToFill: 2,
      isProjection: true,
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
      seatsToFill: 2,
      isProjection: false,
      lists: [{ listId: "A", listName: "Lista A", votes: 90 }],
    });
    expect(historical).toContain(
      "historical simulation has 10 uncovered votes",
    );
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
    // is sourced input. Absent it, say so rather than showing 9 as if it were
    // the council.
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
            threshold: { value: 3, basis: "padron" },
            isProjection: false,
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
    expect(markup).toContain("a council roster is defined only for");
    expect(markup).not.toContain("council-composition");
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

    expect(markup).toContain("not a valid AllocationInput");
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
