import { describe, expect, it } from "vitest";
import { allocateDhondt } from "./dhondt";
import type { DhondtInput } from "./dhondt";

/**
 * D'Hondt - Codigo Electoral Nacional, Ley 19.945, Art. 161. Governs
 * national diputados only (if ever simulated) - never PBA levels.
 */

describe("allocateDhondt", () => {
  it("computes a quotient table over the supplied vote totals and awards seats to the highest quotients", () => {
    const input: DhondtInput = {
      padron: 1_000_000,
      thresholdPercent: 0,
      seatsToFill: 7,
      lists: [
        { listId: "A", listName: "Lista A", votes: 340_000 },
        { listId: "B", listName: "Lista B", votes: 280_000 },
        { listId: "C", listName: "Lista C", votes: 160_000 },
        { listId: "D", listName: "Lista D", votes: 60_000 },
      ],
    };

    const result = allocateDhondt(input);

    // Quotients (top 7 overall): A/1=340k, B/1=280k, A/2=170k, C/1=160k,
    // B/2=140k, A/3=113.3k, B/3=93.3k -> A=3, B=3, C=1, D=0.
    const byList = Object.fromEntries(result.results.map((r) => [r.listId, r]));
    expect(byList.A?.seats).toBe(3);
    expect(byList.B?.seats).toBe(3);
    expect(byList.C?.seats).toBe(1);
    expect(byList.D?.seats).toBe(0);
    expect(result.results.reduce((sum, r) => sum + r.seats, 0)).toBe(7);
    expect(result.quotientTable.length).toBeGreaterThan(0);
  });

  it("excludes a list below the 3% padron threshold but still reports its raw vote share (Art. 160)", () => {
    const input: DhondtInput = {
      padron: 100_000,
      thresholdPercent: 3,
      seatsToFill: 5,
      lists: [
        { listId: "A", listName: "Lista A", votes: 50_000 },
        { listId: "B", listName: "Lista B", votes: 2_000 },
      ],
    };

    const result = allocateDhondt(input);

    // thresholdVotes = 3% of 100.000 = 3.000. B's 2.000 votes are below it.
    const listB = result.results.find((r) => r.listId === "B");
    expect(listB?.excludedByThreshold).toBe(true);
    expect(listB?.votingSharePercent).toBeCloseTo(2, 6);
    expect(listB?.seats).toBe(0);
    // Threshold is a share of the padron, never of valid votes.
    expect(result.thresholdVotes).toBeCloseTo(3_000, 6);

    // Excluded lists never enter the quotient table.
    expect(result.quotientTable.every((q) => q.listId !== "B")).toBe(true);
  });

  it("resolves an equal-quotient tie by higher raw vote total and flags it statutory (Art. 161(c) first clause)", () => {
    const input: DhondtInput = {
      padron: 1_000,
      thresholdPercent: 0,
      seatsToFill: 2,
      lists: [
        { listId: "A", listName: "Lista A", votes: 100 },
        { listId: "B", listName: "Lista B", votes: 50 },
      ],
    };

    const result = allocateDhondt(input);
    // A/1=100, A/2=50, B/1=50, B/2=25. Seat 1 -> A/1 (100, no tie).
    // Seat 2 -> A/2 (50) ties B/1 (50); A has more raw votes (100 > 50) -> A wins.
    const byList = Object.fromEntries(result.results.map((r) => [r.listId, r]));
    expect(byList.A?.seats).toBe(2);
    expect(byList.B?.seats).toBe(0);
    const tieAward = result.seatAwards.find((award) => award.tieBreak !== undefined);
    expect(tieAward?.listId).toBe("A");
    expect(tieAward?.tieBreak?.basis).toBe("statutory");
    expect(tieAward?.tieBreak?.citation).toContain("161");
  });

  it("flags an equal-quotient AND equal-vote tie as a declared simulation convention, not statute (Art. 161(c) ends in sorteo)", () => {
    const input: DhondtInput = {
      padron: 1_000,
      thresholdPercent: 0,
      seatsToFill: 1,
      lists: [
        { listId: "A", listName: "Lista A", votes: 100 },
        { listId: "B", listName: "Lista B", votes: 100 },
      ],
    };

    const result = allocateDhondt(input);
    // Equal quotient (both 100/1) AND equal votes -> statute ends in sorteo,
    // which this system does not perform; deterministic fallback (lower
    // listId) MUST be labelled a simulation convention, never statutory.
    expect(result.seatAwards).toHaveLength(1);
    expect(result.seatAwards[0]?.tieBreak?.basis).toBe("simulation_convention");
    expect(result.seatAwards[0]?.tieBreak?.basis).not.toBe("statutory");
    expect(result.seatAwards[0]?.listId).toBe("A");
  });
});
