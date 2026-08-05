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

  it("gives a below-cuociente list zero seats from the division step but carries its remainder forward", () => {
    const input: HareQuotaInput = {
      voteTotals: { totalVotes: 60, blankVotes: 0, annulledVotes: 0 },
      seatsToFill: 3,
      lists: [
        { listId: "A", listName: "Lista A", votes: 25 },
        { listId: "B", listName: "Lista B", votes: 18 },
        { listId: "C", listName: "Lista C", votes: 17 },
      ],
    };

    const result = allocateHareQuota(input);
    // cuociente = 60 / 3 = 20. B (18) and C (17) are both below 20.
    const listB = result.results.find((r) => r.listId === "B");
    expect(listB?.seatsByCuociente).toBe(0);
    expect(listB?.remainder).toBeGreaterThan(0);
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
    // C: floor(15/20)=0 rem 15. D: floor(7/20)=0 rem 7.
    // sum by cuociente = 3, 2 seats remain, order by remainder: C(15), B(13).
    const byList = Object.fromEntries(result.results.map((r) => [r.listId, r]));
    expect(byList.A?.totalSeats).toBe(2);
    expect(byList.B?.totalSeats).toBe(2);
    expect(byList.C?.totalSeats).toBe(1);
    expect(byList.D?.totalSeats).toBe(0);
    expect(result.results.reduce((sum, r) => sum + r.totalSeats, 0)).toBe(5);
  });

  it("resolves an equal-remainder tie by higher raw vote total and flags it statutory, never a convention (Art. 109(c))", () => {
    const input: HareQuotaInput = {
      voteTotals: { totalVotes: 20, blankVotes: 0, annulledVotes: 0 },
      seatsToFill: 2,
      lists: [
        { listId: "P", listName: "Lista P", votes: 19 },
        { listId: "Q", listName: "Lista Q", votes: 9 },
      ],
    };

    const result = allocateHareQuota(input);
    // cuociente = 20 / 2 = 10. P: floor(19/10)=1 rem 9. Q: floor(9/10)=0 rem 9.
    // Tied remainder (9 == 9), one seat remains -> higher votes (P, 19 > 9) wins.
    const byList = Object.fromEntries(result.results.map((r) => [r.listId, r]));
    expect(byList.P?.totalSeats).toBe(2);
    expect(byList.Q?.totalSeats).toBe(0);
    expect(result.tieBreaks).toHaveLength(1);
    expect(result.tieBreaks[0]?.basis).toBe("statutory");
    expect(result.tieBreaks[0]?.basis).not.toBe("simulation_convention");
    expect(result.tieBreaks[0]?.citation).toContain("109");
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
    expect(result.cuociente).toBeCloseTo(25, 6);
    const byList = Object.fromEntries(result.results.map((r) => [r.listId, r]));
    expect(byList.A?.totalSeats).toBe(2);
    expect(byList.B?.totalSeats).toBe(1);
    expect(byList.C?.totalSeats).toBe(1);
    expect(result.results.reduce((sum, r) => sum + r.totalSeats, 0)).toBe(4);
  });

  it("awards seats to the highest-voted qualifying lists when more lists reach the cuociente than there are seats (Art. 110)", () => {
    const input: HareQuotaInput = {
      voteTotals: { totalVotes: 120, blankVotes: 0, annulledVotes: 0 },
      seatsToFill: 3,
      lists: [
        { listId: "A", listName: "Lista A", votes: 45 },
        { listId: "B", listName: "Lista B", votes: 44 },
        { listId: "C", listName: "Lista C", votes: 43 },
        { listId: "D", listName: "Lista D", votes: 42 },
      ],
    };

    const result = allocateHareQuota(input);
    // cuociente = 120/3 = 40. All four lists (42-45) reach it, but only 3
    // seats exist -> the 3 highest-voted qualifying lists win, D loses out
    // despite technically clearing the bar.
    const byList = Object.fromEntries(result.results.map((r) => [r.listId, r]));
    expect(byList.A?.totalSeats).toBe(1);
    expect(byList.B?.totalSeats).toBe(1);
    expect(byList.C?.totalSeats).toBe(1);
    expect(byList.D?.totalSeats).toBe(0);
    expect(result.results.reduce((sum, r) => sum + r.totalSeats, 0)).toBe(3);
  });

  it("uses 9 (seats up for renewal), not 18 (the council total), as the divisor for a Coronel Rosales concejal election", () => {
    const input: HareQuotaInput = {
      voteTotals: { totalVotes: 35359 * 2, blankVotes: 0, annulledVotes: 35359 },
      seatsToFill: 9,
      councilTotal: 18,
      lists: [{ listId: "L", listName: "Lista L", votes: 10365 }],
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
        totalVotes: TOTAL_VOTES_2023,
        blankVotes: 0,
        annulledVotes: BLANK_AND_ANNULLED_2023,
      },
      seatsToFill: 9,
      councilTotal: 18,
      lists: [
        { listId: "uxp", listName: "UxP", votes: 12_507 },
        { listId: "jxc", listName: "JxC", votes: 10_630 },
        { listId: "lla", listName: "LLA", votes: 10_365 },
        { listId: "ampr", listName: "Agrupación Municipal Primero Rosales", votes: 1_857 },
      ],
    };

    const result = allocateHareQuota(input);

    expect(result.validVotes).toBe(VALID_VOTES_2023);
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

  it("reproduces the full official 2025 Coronel Rosales distrito 027 concejales computation, column by column", () => {
    // Source: https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/concejales_distri/2025027.pdf
    // Published "Cociente: 3.587,8888880" x 9 seats = 32.291 valid votes.
    // No total/blank/annulled breakdown is published for 2025 -- only the
    // valid-vote figure is recoverable by this arithmetic, so totalVotes is
    // modeled equal to validVotes with blank/annulled at 0. This is NOT a
    // claim that zero votes were blank or annulled in 2025; it is what the
    // source actually supports without fabricating an unpublished split.
    const VALID_VOTES_2025 = 32_291;

    const input: HareQuotaInput = {
      voteTotals: { totalVotes: VALID_VOTES_2025, blankVotes: 0, annulledVotes: 0 },
      seatsToFill: 9,
      councilTotal: 18,
      lists: [
        { listId: "lla", listName: "ALIANZA LA LIBERTAD AVANZA", votes: 14_550 },
        { listId: "fp", listName: "ALIANZA FUERZA PATRIA", votes: 7_300 },
        { listId: "potencia", listName: "ALIANZA POTENCIA", votes: 4_540 },
      ],
    };

    const result = allocateHareQuota(input);

    expect(result.validVotes).toBe(VALID_VOTES_2025);
    expect(result.cuociente).toBeCloseTo(3_587.888888, 4);

    const byList = Object.fromEntries(result.results.map((r) => [r.listId, r]));

    expect(byList.lla?.quotient).toBeCloseTo(4.055310, 5);
    expect(byList.lla?.seatsByCuociente).toBe(4);
    expect(byList.lla?.seatsByResidue).toBe(1);
    expect(byList.lla?.totalSeats).toBe(5);

    expect(byList.fp?.quotient).toBeCloseTo(2.034620, 5);
    expect(byList.fp?.seatsByCuociente).toBe(2);
    expect(byList.fp?.seatsByResidue).toBe(0);
    expect(byList.fp?.totalSeats).toBe(2);

    expect(byList.potencia?.quotient).toBeCloseTo(1.265370, 5);
    expect(byList.potencia?.seatsByCuociente).toBe(1);
    expect(byList.potencia?.seatsByResidue).toBe(1);
    expect(byList.potencia?.totalSeats).toBe(2);

    expect(result.results.reduce((sum, r) => sum + r.totalSeats, 0)).toBe(9);

    // The three qualifying lists sum to 26.390 of 32.291 valid votes; the
    // remaining 5.901 valid votes belong to sub-cuociente lists that never
    // appear in this fixture and correctly receive zero representation
    // (Art. 109(b) exclusion) -- there is nothing further to allocate them.
    const qualifyingVotes = 14_550 + 7_300 + 4_540;
    expect(VALID_VOTES_2025 - qualifyingVotes).toBe(5_901);
  });
});
