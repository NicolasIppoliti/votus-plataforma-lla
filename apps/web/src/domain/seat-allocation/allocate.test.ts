import { describe, expect, it } from "vitest";
import { allocateSeats } from "./allocate";
import { UnsupportedMayoriaError } from "./hare-quota";
import type { AllocationInput } from "./types";

const COVERAGE_INPUT = {
  level: "pba_provincial",
  totalVotes: 100,
  blankVotes: 0,
  annulledVotes: 0,
  unmodeledVotes: 0,
  seatsToFill: 2,
  lists: [{ listId: "A", listName: "Lista A", votes: 90 }],
};
describe("allocateSeats", () => {
  it("requires explicit projection provenance instead of defaulting to historical", () => {
    const input = {
      ...COVERAGE_INPUT,
      lists: [{ listId: "A", listName: "Lista A", votes: 100 }],
    };
    expect(() => allocateSeats(input as unknown as AllocationInput)).toThrow(
      /isProjection/,
    );
  });

  it("rejects a council election that allocates anything other than half the council", () => {
    const input = {
      ...COVERAGE_INPUT,
      totalVotes: 90,
      seatsToFill: 8,
      councilTotal: 18,
      isProjection: false,
    };
    expect(() => allocateSeats(input as AllocationInput)).toThrow(
      /half.*council/i,
    );
  });

  it("rejects duplicate list ids at the public allocation boundary", () => {
    const input = {
      ...COVERAGE_INPUT,
      totalVotes: 180,
      isProjection: false,
      lists: [...COVERAGE_INPUT.lists, { ...COVERAGE_INPUT.lists[0]! }],
    };
    expect(() => allocateSeats(input as AllocationInput)).toThrow(
      /duplicate.*listId/i,
    );
  });

  it("preserves combined blank-and-annulled evidence through the public boundary", () => {
    const input = {
      level: "pba_municipal",
      voteTotals: {
        kind: "combined_blank_and_annulled",
        totalVotes: 39_273,
        combinedBlankAndAnnulledVotes: 3_914,
      },
      unmodeledVotes: 0,
      seatsToFill: 9,
      councilTotal: 18,
      isProjection: false,
      lists: [{ listId: "A", listName: "Lista A", votes: 35_359 }],
    };

    const result = allocateSeats(
      input as unknown as AllocationInput,
    ) as unknown as {
      voteTotals: unknown;
      blankVotes?: number;
      annulledVotes?: number;
    };
    expect(result.voteTotals).toEqual(input.voteTotals);
    expect(result.blankVotes).toBeUndefined();
    expect(result.annulledVotes).toBeUndefined();
  });

  it("preserves valid-votes-only evidence and explicit omitted-row coverage", () => {
    const input = {
      level: "pba_municipal",
      voteTotals: { kind: "valid_votes_only", validVotes: 32_291 },
      unmodeledVotes: 5_901,
      seatsToFill: 9,
      councilTotal: 18,
      isProjection: false,
      lists: [
        { listId: "lla", listName: "LLA", votes: 14_550 },
        { listId: "fp", listName: "FP", votes: 7_300 },
        { listId: "potencia", listName: "Potencia", votes: 4_540 },
      ],
    };

    const result = allocateSeats(
      input as unknown as AllocationInput,
    ) as unknown as {
      voteTotals: unknown;
      totalVotes?: number;
      coverage: { complete: boolean; unmodeledVotes: number };
    };
    expect(result.voteTotals).toEqual(input.voteTotals);
    expect(result.totalVotes).toBeUndefined();
    expect(result.coverage).toMatchObject({
      complete: true,
      unmodeledVotes: 5_901,
    });
  });

  it("rejects positive MAYORIA evidence with a typed actionable error", () => {
    const input = {
      ...COVERAGE_INPUT,
      totalVotes: 90,
      isProjection: false,
      mayoriaVotes: 1,
    };

    const allocate = () => allocateSeats(input as unknown as AllocationInput);
    expect(allocate).toThrow(UnsupportedMayoriaError);
    expect(allocate).toThrow(/MAYORIA.*not implemented.*Ley 5109/i);
  });

  it("refuses list and unmodeled votes that exceed the valid-vote basis", () => {
    const input = {
      ...COVERAGE_INPUT,
      unmodeledVotes: 1,
      isProjection: false,
      lists: [{ listId: "A", listName: "Lista A", votes: 100 }],
    };
    expect(() => allocateSeats(input as AllocationInput)).toThrow(
      /exceed.*basis/i,
    );
  });

  it("refuses incomplete historical vote coverage", () => {
    const input = {
      ...COVERAGE_INPUT,
      isProjection: false,
    };
    expect(() => allocateSeats(input as AllocationInput)).toThrow(
      /historical.*10.*uncovered/i,
    );
  });

  it("returns explicit incomplete coverage for a projection", () => {
    const input = {
      ...COVERAGE_INPUT,
      isProjection: true,
    };
    const result = allocateSeats(input as AllocationInput);
    expect(result.coverage).toEqual({
      basisVotes: 100,
      listedVotes: 90,
      unmodeledVotes: 0,
      uncoveredVotes: 10,
      complete: false,
    });
  });

  it("separates statutory historical and projected national threshold policy", () => {
    const historical = {
      level: "national",
      padron: 1_000,
      totalVotes: 500,
      unmodeledVotes: 0,
      threshold: { value: 4, basis: "padron" },
      seatsToFill: 1,
      isProjection: false,
      lists: [{ listId: "A", listName: "Lista A", votes: 500 }],
    };
    expect(() => allocateSeats(historical as AllocationInput)).toThrow(
      /historical national.*3%/i,
    );
    const result = allocateSeats({
      ...historical,
      isProjection: true,
    } as AllocationInput);
    expect(result.level === "national" && result.thresholdPolicy).toBe(
      "scenario_policy",
    );
  });

  it("rejects a PBA payload carrying a threshold key as an unknown key, never a silent ignore (D5)", () => {
    const payload = {
      level: "pba_municipal",
      totalVotes: 100,
      blankVotes: 0,
      annulledVotes: 0,
      unmodeledVotes: 40,
      seatsToFill: 4,
      isProjection: false,
      lists: [{ listId: "A", listName: "Lista A", votes: 60 }],
      threshold: { value: 3, basis: "padron" },
    };

    expect(() =>
      allocateSeats(payload as unknown as AllocationInput),
    ).toThrow();
  });

  it("always resolves a PBA level to Hare quota, with no operator override", () => {
    const input: AllocationInput = {
      level: "pba_municipal",
      totalVotes: 100,
      blankVotes: 0,
      annulledVotes: 0,
      unmodeledVotes: 0,
      seatsToFill: 4,
      isProjection: false,
      lists: [
        { listId: "A", listName: "Lista A", votes: 60 },
        { listId: "B", listName: "Lista B", votes: 40 },
      ],
    };

    const result = allocateSeats(input);
    expect(result.level).toBe("pba_municipal");
    expect("cuociente" in result).toBe(true);
    expect("quotientTable" in result).toBe(false);
  });

  it("always resolves the national level to D'Hondt, with no operator override", () => {
    const input: AllocationInput = {
      level: "national",
      padron: 10_000,
      totalVotes: 9_000,
      unmodeledVotes: 0,
      threshold: { value: 3, basis: "padron" },
      seatsToFill: 3,
      isProjection: false,
      lists: [
        { listId: "A", listName: "Lista A", votes: 6_000 },
        { listId: "B", listName: "Lista B", votes: 3_000 },
      ],
    };

    const result = allocateSeats(input);
    expect(result.level).toBe("national");
    expect("quotientTable" in result).toBe(true);
    expect("cuociente" in result).toBe(false);
  });

  it("makes every awarded seat traceable to the rule that awarded it and the numeric values that rule used", () => {
    const input: AllocationInput = {
      level: "pba_provincial",
      totalVotes: 100,
      blankVotes: 0,
      annulledVotes: 0,
      unmodeledVotes: 0,
      seatsToFill: 4,
      isProjection: false,
      lists: [
        { listId: "A", listName: "Lista A", votes: 60 },
        { listId: "B", listName: "Lista B", votes: 40 },
      ],
    };

    const result = allocateSeats(input);
    expect(result.seatAwards.length).toBeGreaterThan(0);
    for (const award of result.seatAwards) {
      expect(award.listId).toBeTruthy();
      expect(award.awardedBy).toBeTruthy();
      expect(Object.keys(award.values).length).toBeGreaterThan(0);
    }
  });

  it("labels a hypothetical 2027 scenario as a projection, never as a historical result", () => {
    const projected: AllocationInput = {
      level: "pba_municipal",
      totalVotes: 100,
      blankVotes: 0,
      annulledVotes: 0,
      unmodeledVotes: 0,
      seatsToFill: 4,
      isProjection: true,
      lists: [
        { listId: "A", listName: "Lista A", votes: 60 },
        { listId: "B", listName: "Lista B", votes: 40 },
      ],
    };

    const historical: AllocationInput = { ...projected, isProjection: false };

    expect(allocateSeats(projected).isProjection).toBe(true);
    expect(allocateSeats(historical).isProjection).toBe(false);
  });
});
