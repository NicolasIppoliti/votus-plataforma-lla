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
});
