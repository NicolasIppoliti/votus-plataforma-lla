import { describe, expect, it } from "vitest";
import { allocateSeats } from "./allocate";
import type { AllocationInput } from "./types";

describe("allocateSeats", () => {
  it("rejects a PBA payload carrying a threshold key as an unknown key, never a silent ignore (D5)", () => {
    const payload = {
      level: "pba_municipal",
      totalVotes: 100,
      blankVotes: 0,
      annulledVotes: 0,
      seatsToFill: 4,
      lists: [{ listId: "A", listName: "Lista A", votes: 60 }],
      threshold: { value: 3, basis: "padron" },
    };

    expect(() => allocateSeats(payload as unknown as AllocationInput)).toThrow();
  });

  it("always resolves a PBA level to Hare quota, with no operator override", () => {
    const input: AllocationInput = {
      level: "pba_municipal",
      totalVotes: 100,
      blankVotes: 0,
      annulledVotes: 0,
      seatsToFill: 4,
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
      threshold: { value: 3, basis: "padron" },
      seatsToFill: 3,
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
      seatsToFill: 4,
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
