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
  seatsToFill: 9,
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
            threshold: { value: 3, basis: "padron" },
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
        searchParams: Promise.resolve({ council: "Coronel de Marina Leonardo Rosales", input: "{}" }),
      })) as ReactElement,
    );

    expect(markup).toContain("not a valid AllocationInput");
    expect(markup).not.toContain("council-composition");
  });

  it("test_invalid_json_is_refused_as_json_not_as_a_schema_error", async () => {
    const markup = renderToStaticMarkup(
      (await SimulatePage({
        searchParams: Promise.resolve({ council: "Coronel de Marina Leonardo Rosales", input: "{not json" }),
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
});
