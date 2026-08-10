import { describe, expect, it } from "vitest";
import { allocateHareQuota, HareQuotaValidationError } from "./hare-quota";
import type { HareQuotaInput } from "./hare-quota";

/**
 * Ley 5109 (PBA), Arts. 109-110 - Hare quota with largest remainder.
 * Governs Coronel Rosales concejales AND PBA provincial legislators.
 *
 * A `MAYORIA` column exists on the official published results, and is zero
 * in both the 2023 and 2025 Coronel Rosales concejales elections observed.
 * It is NOT modeled here: it is an unexercised statutory provision, not a
 * missing feature. If it is ever exercised (a party winning outright
 * majority per a rule not yet read from the statute text), this module
 * will need a new requirement, not a silent workaround.
 */

describe("allocateHareQuota", () => {
  it("computes the cuociente denominator excluding blank and annulled votes (Art. 109 final paragraph)", () => {
    const input: HareQuotaInput = {
      voteTotals: { totalVotes: 1000, blankVotes: 50, annulledVotes: 30 },
      seatsToFill: 4,
      lists: [{ listId: "A", listName: "Lista A", votes: 920 }],
    };

    const result = allocateHareQuota(input);

    // 1000 - 50 - 30 = 920 valid votes; cuociente = 920 / 4 = 230.
    expect(result.validVotes).toBe(920);
    expect(result.totalVotes).toBe(1000);
    expect(result.blankVotes).toBe(50);
    expect(result.annulledVotes).toBe(30);
    expect(result.cuociente).toBeCloseTo(230, 6);
  });

  it("gives a below-cuociente list no representation, including no remainder seat", () => {
    const input: HareQuotaInput = {
      voteTotals: { totalVotes: 60, blankVotes: 0, annulledVotes: 0 },
      seatsToFill: 3,
      lists: [
        { listId: "A", listName: "Lista A", votes: 25 },
        { listId: "B", listName: "Lista B", votes: 20 },
        { listId: "C", listName: "Lista C", votes: 15 },
      ],
    };

    const result = allocateHareQuota(input);
    const listC = result.results.find((r) => r.listId === "C");
    expect(listC?.seatsByCuociente).toBe(0);
    expect(listC?.seatsByResidue).toBe(0);
    expect(listC?.totalSeats).toBe(0);
  });

  it("does not round a list one exact vote-ratio below the cuociente into qualification", () => {
    const input: HareQuotaInput = {
      voteTotals: {
        totalVotes: 9_000_000_000_000_001,
        blankVotes: 0,
        annulledVotes: 0,
      },
      seatsToFill: 3,
      lists: [
        { listId: "A", listName: "Lista A", votes: 3_000_000_000_000_000 },
        { listId: "B", listName: "Lista B", votes: 6_000_000_000_000_001 },
      ],
    };

    const result = allocateHareQuota(input);
    const byList = Object.fromEntries(
      result.results.map((entry) => [entry.listId, entry]),
    );
    expect(byList.A?.totalSeats).toBe(0);
    expect(byList.B?.totalSeats).toBe(3);
  });

  it("orders the largest-remainder top-up strictly by descending remainder", () => {
    const input: HareQuotaInput = {
      voteTotals: { totalVotes: 100, blankVotes: 0, annulledVotes: 0 },
      seatsToFill: 5,
      lists: [
        { listId: "A", listName: "Lista A", votes: 45 },
        { listId: "B", listName: "Lista B", votes: 33 },
        { listId: "C", listName: "Lista C", votes: 15 },
        { listId: "D", listName: "Lista D", votes: 7 },
      ],
    };

    const result = allocateHareQuota(input);
    // cuociente = 100 / 5 = 20.
    // A: floor(45/20)=2 rem 5. B: floor(33/20)=1 rem 13.
    const byList = Object.fromEntries(result.results.map((r) => [r.listId, r]));
    expect(byList.A?.totalSeats).toBe(3);
    expect(byList.B?.totalSeats).toBe(2);
    expect(byList.C?.totalSeats).toBe(0);
    expect(byList.D?.totalSeats).toBe(0);
    expect(result.results.reduce((sum, r) => sum + r.totalSeats, 0)).toBe(5);
  });

  it("resolves an equal-remainder tie by higher raw vote total and flags it statutory, never a convention (Art. 109(c))", () => {
    const input: HareQuotaInput = {
      voteTotals: { totalVotes: 40, blankVotes: 0, annulledVotes: 0 },
      seatsToFill: 4,
      lists: [
        { listId: "P", listName: "Lista P", votes: 24 },
        { listId: "Q", listName: "Lista Q", votes: 14 },
      ],
    };

    const result = allocateHareQuota(input);
    const byList = Object.fromEntries(result.results.map((r) => [r.listId, r]));
    expect(byList.P?.totalSeats).toBe(3);
    expect(byList.Q?.totalSeats).toBe(1);
    expect(result.tieBreaks).toHaveLength(1);
    expect(result.tieBreaks[0]?.basis).toBe("statutory");
    expect(result.tieBreaks[0]?.basis).not.toBe("simulation_convention");
    expect(result.tieBreaks[0]?.citation).toContain("109");
  });

  it("labels the deterministic fallback for equal remainders and equal votes as a convention", () => {
    const input: HareQuotaInput = {
      voteTotals: { totalVotes: 300, blankVotes: 0, annulledVotes: 0 },
      seatsToFill: 3,
      lists: [
        { listId: "C", listName: "Lista C", votes: 150 },
        { listId: "B", listName: "Lista B", votes: 150 },
      ],
    };

    const result = allocateHareQuota(input);
    const tieAward = result.seatAwards.find(
      (award) => award.tieBreak !== undefined,
    );

    expect(tieAward?.listId).toBe("B");
    expect(tieAward?.tieBreak?.basis).toBe("simulation_convention");
    expect(tieAward?.tieBreak?.rule).toMatch(/lower list id/i);
  });

  it("halves the cuociente repeatedly per Art. 110 until at least one list qualifies", () => {
    const input: HareQuotaInput = {
      voteTotals: { totalVotes: 400, blankVotes: 0, annulledVotes: 0 },
      seatsToFill: 4,
      lists: [
        { listId: "A", listName: "Lista A", votes: 40 },
        { listId: "B", listName: "Lista B", votes: 30 },
        { listId: "C", listName: "Lista C", votes: 20 },
      ],
    };

    const result = allocateHareQuota(input);
    // Initial cuociente = 400/4 = 100 -> nobody qualifies (40, 30, 20 < 100).
    // Halve to 50 -> still nobody qualifies (40, 30, 20 < 50).
    // Halve to 25 -> A(40) and B(30) qualify. Two halving iterations recorded.
    expect(result.halvingIterations).toBe(2);
    expect(result.initialCuociente).toBe(100);
    expect(result.halvingSteps).toEqual([
      { iteration: 1, cuociente: 50, qualifyingListIds: [] },
      { iteration: 2, cuociente: 25, qualifyingListIds: ["A", "B"] },
    ]);
    expect(result.cuociente).toBeCloseTo(25, 6);
    const byList = Object.fromEntries(result.results.map((r) => [r.listId, r]));
    expect(byList.A?.totalSeats).toBe(2);
    expect(byList.B?.totalSeats).toBe(2);
    expect(byList.C?.totalSeats).toBe(0);
    expect(result.results.reduce((sum, r) => sum + r.totalSeats, 0)).toBe(4);
  });

  it("awards seats to the highest-voted qualifying lists when more lists reach the cuociente than there are seats (Art. 110)", () => {
    const input: HareQuotaInput = {
      voteTotals: { totalVotes: 174, blankVotes: 0, annulledVotes: 0 },
      seatsToFill: 3,
      lists: [
        { listId: "A", listName: "Lista A", votes: 45 },
        { listId: "B", listName: "Lista B", votes: 44 },
        { listId: "C", listName: "Lista C", votes: 43 },
        { listId: "D", listName: "Lista D", votes: 42 },
      ],
    };

    const result = allocateHareQuota(input);
    // Initial cuociente 58 is halved to 29; all four lists qualify for 3 seats.
    const byList = Object.fromEntries(result.results.map((r) => [r.listId, r]));
    expect(byList.A?.totalSeats).toBe(1);
    expect(byList.B?.totalSeats).toBe(1);
    expect(byList.C?.totalSeats).toBe(1);
    expect(byList.D?.totalSeats).toBe(0);
    expect(byList.D?.initialSeatsByCuociente).toBe(1);
    expect(result.seatCap).toEqual({
      availableSeats: 3,
      qualifyingListIds: ["A", "B", "C", "D"],
      awardedListIds: ["A", "B", "C"],
      excludedListIds: ["D"],
    });
    expect(result.results.reduce((sum, r) => sum + r.totalSeats, 0)).toBe(3);
  });

  it("records the simulation convention when equal votes meet at the Art. 110 seat cap", () => {
    const input: HareQuotaInput = {
      voteTotals: { totalVotes: 175, blankVotes: 0, annulledVotes: 0 },
      seatsToFill: 3,
      lists: [
        { listId: "A", listName: "Lista A", votes: 45 },
        { listId: "B", listName: "Lista B", votes: 44 },
        { listId: "D", listName: "Lista D", votes: 43 },
        { listId: "C", listName: "Lista C", votes: 43 },
      ],
    };
    const result = allocateHareQuota(input);
    expect(result.seatCap?.awardedListIds).toEqual(["A", "B", "C"]);
    expect(result.seatCap?.excludedListIds).toEqual(["D"]);
    expect(result.seatCap?.tieBreak?.basis).toBe("simulation_convention");
    expect(
      result.seatAwards.find((award) => award.listId === "C")?.tieBreak?.rule,
    ).toMatch(/seat cap/i);
  });

  it("uses 9 (seats up for renewal), not 18 (the council total), as the divisor for a Coronel Rosales concejal election", () => {
    const input: HareQuotaInput = {
      voteTotals: {
        totalVotes: 35359 * 2,
        blankVotes: 0,
        annulledVotes: 35359,
      },
      seatsToFill: 9,
      councilTotal: 18,
      lists: [
        { listId: "uxp", listName: "UxP", votes: 12_507 },
        { listId: "jxc", listName: "JxC", votes: 10_630 },
        { listId: "lla", listName: "LLA", votes: 10_365 },
        { listId: "ampr", listName: "AMPR", votes: 1_857 },
      ],
    };

    const result = allocateHareQuota(input);
    expect(result.seatsToFill).toBe(9);
    expect(result.cuociente).toBeCloseTo(35359 / 9, 6);
  });

  it("rejects a run configured with 18 seats to fill in a single Coronel Rosales concejal election", () => {
    const input: HareQuotaInput = {
      voteTotals: { totalVotes: 39273, blankVotes: 2000, annulledVotes: 1914 },
      seatsToFill: 18,
      councilTotal: 18,
      lists: [{ listId: "L", listName: "Lista L", votes: 10365 }],
    };

    expect(() => allocateHareQuota(input)).toThrow(HareQuotaValidationError);
    expect(() => allocateHareQuota(input)).toThrow(/council total/i);
  });

  it("preserves a reported combined blank-and-annulled count without fabricating either category", () => {
    const input = {
      voteTotals: {
        kind: "combined_blank_and_annulled",
        totalVotes: 39_273,
        combinedBlankAndAnnulledVotes: 3_914,
      },
      sourceCoverage: { unmodeledVotes: 0 },
      seatsToFill: 9,
      lists: [{ listId: "A", listName: "Lista A", votes: 35_359 }],
    } as unknown as HareQuotaInput;

    const result = allocateHareQuota(input);
    expect(result.validVotes).toBe(35_359);
    expect(result.blankVotes).toBeUndefined();
    expect(result.annulledVotes).toBeUndefined();
    expect(result.voteTotals).toEqual(input.voteTotals);
  });

  it("preserves a valid-votes-only source without coercing unknown totals to zero", () => {
    const input = {
      voteTotals: { kind: "valid_votes_only", validVotes: 32_291 },
      sourceCoverage: { unmodeledVotes: 5_901 },
      seatsToFill: 9,
      lists: [
        { listId: "lla", listName: "LLA", votes: 14_550 },
        { listId: "fp", listName: "FP", votes: 7_300 },
        { listId: "potencia", listName: "Potencia", votes: 4_540 },
      ],
    } as unknown as HareQuotaInput;

    const result = allocateHareQuota(input);
    expect(result.totalVotes).toBeUndefined();
    expect(result.blankVotes).toBeUndefined();
    expect(result.annulledVotes).toBeUndefined();
    expect(result.sourceCoverage?.complete).toBe(true);
  });

  it("refuses omitted source rows that are presented as complete coverage", () => {
    const input = {
      voteTotals: { kind: "valid_votes_only", validVotes: 32_291 },
      sourceCoverage: { unmodeledVotes: 0 },
      seatsToFill: 9,
      lists: [
        { listId: "lla", listName: "LLA", votes: 14_550 },
        { listId: "fp", listName: "FP", votes: 7_300 },
        { listId: "potencia", listName: "Potencia", votes: 4_540 },
      ],
    } as unknown as HareQuotaInput;

    expect(() => allocateHareQuota(input)).toThrow(/5,?901.*uncovered/i);
  });

  it("refuses an insufficient scenario instead of returning a partial allocation", () => {
    const input: HareQuotaInput = {
      voteTotals: { totalVotes: 100, blankVotes: 0, annulledVotes: 0 },
      seatsToFill: 9,
      lists: [{ listId: "A", listName: "Lista A", votes: 1 }],
    };

    expect(() => allocateHareQuota(input)).toThrow(
      /cannot allocate all 9 seats/i,
    );
  });

  it("never lets a zero-vote list fill an otherwise unallocated remainder seat", () => {
    const input: HareQuotaInput = {
      voteTotals: { totalVotes: 140, blankVotes: 0, annulledVotes: 0 },
      seatsToFill: 7,
      lists: [
        { listId: "A", listName: "Lista A", votes: 60 },
        { listId: "B", listName: "Lista B", votes: 20 },
        { listId: "ZERO", listName: "Lista Cero", votes: 0 },
      ],
    };

    expect(() => allocateHareQuota(input)).toThrow(
      /cannot allocate all 7 seats/i,
    );
  });

  it("reproduces the official 2023 Coronel Rosales distrito 027 concejales result (UxP 3 / JxC 3 / LLA 3 / AMPR 0)", () => {
    // Source: https://www.juntaelectoral.gba.gov.ar/resultados-generales/2023027.pdf
    // Published "COCIENTE CONCEJALES 3.928,777777" x 9 seats = 35.359 valid votes.
    // 39.273 is the TOTAL vote count (39.273 - 35.359 = 3.914 blank + annulled)
    // and is reported here for cross-check only, never used as the divisor.
    const TOTAL_VOTES_2023 = 39_273;
    const VALID_VOTES_2023 = 35_359;
    const BLANK_AND_ANNULLED_2023 = TOTAL_VOTES_2023 - VALID_VOTES_2023;

    const input: HareQuotaInput = {
      voteTotals: {
        kind: "combined_blank_and_annulled",
        totalVotes: TOTAL_VOTES_2023,
        combinedBlankAndAnnulledVotes: BLANK_AND_ANNULLED_2023,
      },
      sourceCoverage: { unmodeledVotes: 0 },
      seatsToFill: 9,
      councilTotal: 18,
      lists: [
        { listId: "uxp", listName: "UxP", votes: 12_507 },
        { listId: "jxc", listName: "JxC", votes: 10_630 },
        { listId: "lla", listName: "LLA", votes: 10_365 },
        {
          listId: "ampr",
          listName: "Agrupación Municipal Primero Rosales",
          votes: 1_857,
        },
      ],
    };

    const result = allocateHareQuota(input);

    expect(result.validVotes).toBe(VALID_VOTES_2023);
    expect(result.blankVotes).toBeUndefined();
    expect(result.annulledVotes).toBeUndefined();
    expect(result.combinedBlankAndAnnulledVotes).toBe(3_914);
    expect(result.cuociente).toBeCloseTo(3_928.777777, 5);

    const byList = Object.fromEntries(result.results.map((r) => [r.listId, r]));
    expect(byList.uxp?.totalSeats).toBe(3);
    expect(byList.jxc?.totalSeats).toBe(3);
    expect(byList.lla?.totalSeats).toBe(3);
    expect(byList.ampr?.totalSeats).toBe(0);
    expect(result.results.reduce((sum, r) => sum + r.totalSeats, 0)).toBe(9);

    // LLA 10.365 / 35.359 = 29,31% — independent confirmation the denominator is correct.
    const llaShare = (10_365 / VALID_VOTES_2023) * 100;
    expect(llaShare).toBeCloseTo(29.31, 1);
  });

  it("reproduces the published 2025 qualifying-list columns and explicitly accounts for omitted source rows", () => {
    // Source: https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/concejales_distri/2025027.pdf
    // Published "Cociente: 3.587,8888880" x 9 seats = 32.291 valid votes.
    // No total/blank/annulled breakdown is published for 2025. Only the
    // valid-vote basis is modeled; 5.901 valid votes from source rows omitted
    // from this narrowed qualifying-list fixture are explicit unmodeled input.
    const VALID_VOTES_2025 = 32_291;

    const input: HareQuotaInput = {
      voteTotals: {
        kind: "valid_votes_only",
        validVotes: VALID_VOTES_2025,
      },
      sourceCoverage: { unmodeledVotes: 5_901 },
      seatsToFill: 9,
      councilTotal: 18,
      lists: [
        {
          listId: "lla",
          listName: "ALIANZA LA LIBERTAD AVANZA",
          votes: 14_550,
        },
        { listId: "fp", listName: "ALIANZA FUERZA PATRIA", votes: 7_300 },
        { listId: "potencia", listName: "ALIANZA POTENCIA", votes: 4_540 },
      ],
    };

    const result = allocateHareQuota(input);

    expect(result.validVotes).toBe(VALID_VOTES_2025);
    expect(result.totalVotes).toBeUndefined();
    expect(result.blankVotes).toBeUndefined();
    expect(result.annulledVotes).toBeUndefined();
    expect(result.sourceCoverage).toEqual({
      listedVotes: 26_390,
      unmodeledVotes: 5_901,
      uncoveredVotes: 0,
      complete: true,
    });
    expect(result.cuociente).toBeCloseTo(3_587.888888, 4);

    const byList = Object.fromEntries(result.results.map((r) => [r.listId, r]));

    // The published QUOTIENT column is 5-decimal precision displayed as 6 with a
    // trailing zero pad, not a 6-decimal figure. Verified across all three lists:
    // exact 4.0553095 -> 4.05531 -> printed "4,055310"; 2.0346227 -> 2.03462 ->
    // "2,034620"; 1.2653681 -> 1.26537 -> "1,265370". Rounding the computed quotient
    // to 5 decimals therefore reproduces the document exactly, so these assertions
    // are exact rather than approximate. Seat counts below are asserted with toBe:
    // they are integers and must never carry a tolerance.
    const to5 = (q: number | undefined): number =>
      Number((q ?? Number.NaN).toFixed(5));

    expect(to5(byList.lla?.quotient)).toBe(4.05531);
    expect(byList.lla?.seatsByCuociente).toBe(4);
    expect(byList.lla?.seatsByResidue).toBe(1);
    expect(byList.lla?.totalSeats).toBe(5);

    expect(to5(byList.fp?.quotient)).toBe(2.03462);
    expect(byList.fp?.seatsByCuociente).toBe(2);
    expect(byList.fp?.seatsByResidue).toBe(0);
    expect(byList.fp?.totalSeats).toBe(2);

    expect(to5(byList.potencia?.quotient)).toBe(1.26537);
    expect(byList.potencia?.seatsByCuociente).toBe(1);
    expect(byList.potencia?.seatsByResidue).toBe(1);
    expect(byList.potencia?.totalSeats).toBe(2);

    expect(result.results.reduce((sum, r) => sum + r.totalSeats, 0)).toBe(9);

    // The narrowed fixture does not invent identities or per-list values for
    // the omitted source rows; it asserts only their evidenced aggregate.
    const qualifyingVotes = 14_550 + 7_300 + 4_540;
    expect(VALID_VOTES_2025 - qualifyingVotes).toBe(5_901);
  });
});
