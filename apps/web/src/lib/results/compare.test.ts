import { describe, expect, it } from "vitest";
import { compareResults } from "./compare";
import type { CompareInput } from "./compare";

/**
 * results-analysis spec: cross-year (2023 vs 2025) comparison at the
 * finest granularity available, mixed-granularity refusal (design.md D6),
 * and swing/flip detection with discontinuous-mesa handling.
 */

describe("compareResults", () => {
  it("test_mesa_level_comparison_when_both_years_available", () => {
    const input: CompareInput = {
      granularity2023: "mesa",
      granularity2025: "mesa",
      units2023: [
        {
          unitId: "mesa-1",
          parties: [
            { party: "A", votes: 60 },
            { party: "B", votes: 40 },
          ],
        },
      ],
      units2025: [
        {
          unitId: "mesa-1",
          parties: [
            { party: "A", votes: 55 },
            { party: "B", votes: 45 },
          ],
        },
      ],
    };

    const result = compareResults(input);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok status");
    expect(result.granularity).toBe("mesa");
    expect(result.swings).toHaveLength(1);
    expect(result.swings[0]?.unitId).toBe("mesa-1");
    expect(result.swings[0]?.shares2023.find((s) => s.party === "A")?.votes).toBe(60);
    expect(result.swings[0]?.shares2025.find((s) => s.party === "A")?.votes).toBe(55);
  });

  it("test_distrito_only_comparison_labeled_distrito_not_mesa", () => {
    const input: CompareInput = {
      granularity2023: "distrito",
      granularity2025: "distrito",
      units2023: [
        {
          unitId: "distrito-027",
          parties: [{ party: "A", votes: 1000 }],
        },
      ],
      units2025: [
        {
          unitId: "distrito-027",
          parties: [{ party: "A", votes: 1100 }],
        },
      ],
    };

    const result = compareResults(input);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok status");
    expect(result.granularity).toBe("distrito");
    expect(result.granularity).not.toBe("mesa");
  });

  it("test_mixed_granularity_returns_requires_explicit_aggregation_status", () => {
    const input: CompareInput = {
      granularity2023: "mesa",
      granularity2025: "distrito",
      units2023: [{ unitId: "mesa-1", parties: [{ party: "A", votes: 10 }] }],
      units2025: [{ unitId: "distrito-027", parties: [{ party: "A", votes: 1000 }] }],
    };

    const result = compareResults(input);

    expect(result.status).toBe("requires_explicit_aggregation");
    if (result.status !== "requires_explicit_aggregation") {
      throw new Error("expected requires_explicit_aggregation status");
    }
    expect(result.granularity2023).toBe("mesa");
    expect(result.granularity2025).toBe("distrito");
    // No figures are carried on a refused comparison (D6).
    expect("swings" in result).toBe(false);
  });

  it("test_duplicate_units_and_parties_are_order_independent_invalid_input", () => {
    const units2023: CompareInput["units2023"] = [
      { unitId: "unit-b", parties: [{ party: "A", votes: 70 }] },
      { unitId: "unit-b", parties: [{ party: "B", votes: 30 }] },
    ];
    const parties2025 = [
      { party: "Z", votes: 60 },
      { party: "A", votes: 20 },
      { party: "Z", votes: 20 },
    ];
    const compare = (reverse: boolean) =>
      compareResults({
        granularity2023: "mesa",
        granularity2025: "mesa",
        units2023: (reverse ? [...units2023].reverse() : units2023).map(
          (unit) => ({
            ...unit,
            parties: reverse ? [...unit.parties].reverse() : unit.parties,
          }),
        ),
        units2025: [{
          unitId: "unit-a",
          parties: reverse ? [...parties2025].reverse() : parties2025,
        }],
      });

    const forward = compare(false);
    const reversed = compare(true);

    expect(forward).toEqual(reversed);
    expect(forward).toEqual({
      status: "invalid_comparison_input",
      issues: [
        { code: "duplicate_unit_id", year: "2023", unitId: "unit-b" },
        { code: "duplicate_party_id", year: "2025", unitId: "unit-a", partyId: "Z" },
      ],
    });
    expect("swings" in forward).toBe(false);
  });

  it("test_unsafe_public_shapes_are_refused_while_zero_votes_remain_valid", () => {
    const postgresIntMax = 2_147_483_647;
    const invalidUnits: CompareInput["units2023"] = [
      { unitId: " ", parties: [{ party: "A", votes: 1 }] },
      { unitId: "unit-empty", parties: [] },
      { unitId: "unit-conflicting-mesa-shapes", parties: [{ party: "A", votes: 1 }], mesaTipo: "NATIVOS", mesaPopulation: { knownTypes: ["EXTRANJEROS"], taggedRows: 1, untaggedRows: 0 } },
      { unitId: "unit-duplicate-mesa-type", parties: [{ party: "A", votes: 1 }], mesaPopulation: { knownTypes: ["NATIVOS", "NATIVOS"], taggedRows: 1, untaggedRows: 0 } },
      {
        unitId: "unit-invalid",
        parties: [
          { party: " ", votes: -1 },
          { party: "B", votes: Number.POSITIVE_INFINITY },
          { party: "C", votes: 0.5 },
          { party: "D", votes: Number.NaN },
          { party: "E", votes: Number.MAX_SAFE_INTEGER + 1 },
          { party: "F", votes: postgresIntMax + 1 },
        ],
        mesaPopulation: { knownTypes: ["NATIVOS"], taggedRows: -1, untaggedRows: 0 },
      },
      { unitId: "unit-overflow", parties: [{ party: "A", votes: Number.MAX_VALUE }, { party: "B", votes: Number.MAX_VALUE }] },
    ];
    const compareUnsafe = (reverse: boolean) => compareResults({
      granularity2023: "mesa",
      granularity2025: "mesa",
      units2023: (reverse ? [...invalidUnits].reverse() : invalidUnits).map((unit) => ({
        ...unit,
        parties: reverse ? [...unit.parties].reverse() : unit.parties,
      })),
      units2025: [{ unitId: "unit-valid", parties: [{ party: "A", votes: 0 }] }],
    });

    const invalid = compareUnsafe(false);
    expect(compareUnsafe(true)).toEqual(invalid);
    expect(invalid).toEqual({
      status: "invalid_comparison_input",
      issues: [
        { code: "empty_party_id", year: "2023", unitId: "unit-invalid", partyId: " " },
        { code: "empty_party_set", year: "2023", unitId: "unit-empty" },
        { code: "empty_unit_id", year: "2023", unitId: " " },
        { code: "invalid_mesa_population", year: "2023", unitId: "unit-conflicting-mesa-shapes" },
        { code: "invalid_mesa_population", year: "2023", unitId: "unit-duplicate-mesa-type" },
        { code: "invalid_mesa_population", year: "2023", unitId: "unit-invalid" },
        { code: "invalid_vote_total", year: "2023", unitId: "unit-invalid" },
        { code: "invalid_vote_total", year: "2023", unitId: "unit-overflow" },
        { code: "invalid_votes", year: "2023", unitId: "unit-invalid", partyId: " " },
        { code: "invalid_votes", year: "2023", unitId: "unit-invalid", partyId: "B" },
        { code: "invalid_votes", year: "2023", unitId: "unit-invalid", partyId: "C" },
        { code: "invalid_votes", year: "2023", unitId: "unit-invalid", partyId: "D" },
        { code: "invalid_votes", year: "2023", unitId: "unit-invalid", partyId: "E" },
        { code: "invalid_votes", year: "2023", unitId: "unit-invalid", partyId: "F" },
        { code: "invalid_votes", year: "2023", unitId: "unit-overflow", partyId: "A" },
        { code: "invalid_votes", year: "2023", unitId: "unit-overflow", partyId: "B" },
      ],
    });
    expect("swings" in invalid).toBe(false);

    for (const votes of [0, 42, postgresIntMax]) {
      const valid = compareResults({
        granularity2023: "mesa",
        granularity2025: "mesa",
        units2023: [{ unitId: "unit-valid", parties: [{ party: "A", votes }] }],
        units2025: [{ unitId: "unit-valid", parties: [{ party: "A", votes }] }],
      });
      expect(valid.status).toBe("ok");
    }
  });

  it.each([
    ["distrito", "mesa", "distrito", "distrito-027", "mesa-0001"], ["mesa", "circuito", "seccion", "mesa-0001", "circuito-001"],
  ] as const)("test_mixed_granularity_refuses_legacy_aggregate_request_%s_%s", (granularity2023, granularity2025, aggregateTo, unitId2023, unitId2025) => {
    const legacyInput = { granularity2023, granularity2025, aggregateTo, units2023: [{ unitId: unitId2023, parties: [{ party: "A", votes: 100 }] }], units2025: [{ unitId: unitId2025, parties: [{ party: "A", votes: 120 }] }] };
    const result = compareResults(legacyInput);
    expect(result).toEqual({ status: "requires_explicit_aggregation", granularity2023, granularity2025 });
    expect("swings" in result).toBe(false);
  });

  it("test_tied_leader_is_an_order_independent_ambiguity_without_figures", () => {
    const inputWith2023Parties = (
      parties: CompareInput["units2023"][number]["parties"],
    ): CompareInput => ({
      granularity2023: "mesa",
      granularity2025: "mesa",
      units2023: [{ unitId: "mesa-tie", parties }],
      units2025: [
        {
          unitId: "mesa-tie",
          parties: [
            { party: "A", votes: 60 },
            { party: "B", votes: 40 },
          ],
        },
      ],
    });
    const parties = [
      { party: "B", votes: 50 },
      { party: "A", votes: 50 },
    ];

    const forward = compareResults(inputWith2023Parties(parties));
    const reversed = compareResults(
      inputWith2023Parties([...parties].reverse()),
    );

    expect(forward).toEqual(reversed);
    expect(forward).toEqual({
      status: "ambiguous_leader",
      ambiguities: [{ unitId: "mesa-tie", year: "2023", parties: ["A", "B"] }],
    });
    expect("swings" in forward).toBe(false);
  });

  it("test_flip_detection_reports_from_to_with_both_shares", () => {
    const input: CompareInput = {
      granularity2023: "mesa",
      granularity2025: "mesa",
      units2023: [
        {
          unitId: "mesa-2",
          parties: [
            { party: "A", votes: 70 },
            { party: "B", votes: 30 },
          ],
        },
      ],
      units2025: [
        {
          unitId: "mesa-2",
          parties: [
            { party: "A", votes: 30 },
            { party: "B", votes: 70 },
          ],
        },
      ],
    };

    const result = compareResults(input);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok status");
    const swing = result.swings[0];
    expect(swing?.flipped).toBe(true);
    expect(swing?.fromParty).toBe("A");
    expect(swing?.toParty).toBe("B");
    expect(swing?.shares2023.length).toBeGreaterThan(0);
    expect(swing?.shares2025.length).toBeGreaterThan(0);
  });

  it("test_no_flip_still_reports_swing", () => {
    const input: CompareInput = {
      granularity2023: "mesa",
      granularity2025: "mesa",
      units2023: [
        {
          unitId: "mesa-3",
          parties: [
            { party: "A", votes: 80 },
            { party: "B", votes: 20 },
          ],
        },
      ],
      units2025: [
        {
          unitId: "mesa-3",
          parties: [
            { party: "A", votes: 65 },
            { party: "B", votes: 35 },
          ],
        },
      ],
    };

    const result = compareResults(input);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok status");
    const swing = result.swings[0];
    expect(swing?.flipped).toBe(false);
    const partySwing = swing?.swings.find((s) => s.party === "A");
    expect(partySwing?.swingPercentPoints).toBeCloseTo(-15, 6);
  });

  it("test_discontinuous_mesa_excluded_from_swing_and_listed_separately", () => {
    const input: CompareInput = {
      granularity2023: "mesa",
      granularity2025: "mesa",
      units2023: [
        { unitId: "mesa-4", parties: [{ party: "A", votes: 10 }] },
        { unitId: "mesa-5", parties: [{ party: "A", votes: 20 }] },
      ],
      units2025: [{ unitId: "mesa-5", parties: [{ party: "A", votes: 25 }] }],
    };

    const result = compareResults(input);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok status");
    expect(result.swings.map((s) => s.unitId)).toEqual(["mesa-5"]);
    expect(result.discontinuities).toEqual([{ unitId: "mesa-4", presentIn: "2023" }]);
  });

  it("test_cross_year_comparison_flags_a_mesa_population_mismatch", () => {
    // Phase 16a: a real electoral fact, not a defect — foreign-resident
    // (`EXTRANJEROS`) mesas vote in PBA provincial/municipal races but not
    // national ones. Comparing a category where one year's mesa set carries
    // an `EXTRANJEROS` mesa and the other year's does not MUST surface that
    // as a population mismatch, never average silently over it.
    const input: CompareInput = {
      granularity2023: "mesa",
      granularity2025: "mesa",
      units2023: [
        {
          unitId: "mesa-1",
          parties: [{ party: "A", votes: 60 }],
          mesaTipo: "NATIVOS",
        },
        {
          unitId: "mesa-9001",
          parties: [{ party: "A", votes: 5 }],
          mesaTipo: "EXTRANJEROS",
        },
      ],
      units2025: [
        {
          unitId: "mesa-1",
          parties: [{ party: "A", votes: 55 }],
          mesaTipo: "NATIVOS",
        },
      ],
    };

    const result = compareResults(input);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok status");
    expect(result.mesaPopulationMismatch).toEqual({
      types2023: ["EXTRANJEROS", "NATIVOS"],
      types2025: ["NATIVOS"],
    });
  });

  it("test_no_mesa_population_mismatch_when_types_match", () => {
    const input: CompareInput = {
      granularity2023: "mesa",
      granularity2025: "mesa",
      units2023: [
        {
          unitId: "mesa-1",
          parties: [{ party: "A", votes: 60 }],
          mesaTipo: "NATIVOS",
        },
      ],
      units2025: [
        {
          unitId: "mesa-1",
          parties: [{ party: "A", votes: 55 }],
          mesaTipo: "NATIVOS",
        },
      ],
    };

    const result = compareResults(input);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok status");
    expect(result.mesaPopulationMismatch).toBeUndefined();
  });

  it("test_partial_mesa_population_metadata_is_a_typed_refusal_without_figures", () => {
    const input: CompareInput = {
      granularity2023: "mesa",
      granularity2025: "mesa",
      units2023: [
        {
          unitId: "mesa-1",
          parties: [{ party: "A", votes: 60 }],
          mesaTipo: "NATIVOS",
        },
        { unitId: "mesa-2", parties: [{ party: "A", votes: 5 }] },
      ],
      units2025: [
        {
          unitId: "mesa-1",
          parties: [{ party: "A", votes: 55 }],
          mesaTipo: "NATIVOS",
        },
      ],
    };

    const result = compareResults(input);

    expect(result).toEqual({
      status: "mesa_population_partial_coverage",
      coverages: [
        {
          year: "2023",
          knownTypes: ["NATIVOS"],
          taggedRows: 1,
          untaggedRows: 1,
        },
      ],
    });
    expect("swings" in result).toBe(false);
  });
});
