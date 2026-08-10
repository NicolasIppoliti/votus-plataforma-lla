/**
 * Hare quota with largest remainder - Ley 5109 (PBA), Arts. 109-110.
 *
 * Governs Coronel Rosales concejales and PBA provincial legislators. This
 * module is deliberately MODULE-PRIVATE (design.md D3): it MUST only ever
 * be imported by `allocate.ts` inside this same directory. It has no I/O
 * and no knowledge of the Zod/web boundary - it is a pure function over
 * plain numbers.
 *
 * Art. 109(a): cuociente = valid votes / seats to fill.
 * Art. 109(b): each list's votes / cuociente (integer part) is its seat
 *              count; a list below the cuociente gets zero seats from this
 *              step.
 * Art. 109(c): leftover seats go to the largest remainders, in descending
 *              order; equal remainders are resolved by higher raw vote
 *              total - STATUTORY, deterministic, never a "convention".
 * Art. 109 final paragraph: blank and annulled votes are EXCLUDED from the
 *              cuociente denominator.
 * Art. 110: if no list reaches the cuociente, halve it repeatedly until at
 *              least one list qualifies; if more lists reach the cuociente
 *              than there are seats, seats go to the highest-voted
 *              qualifying lists.
 *
 * There is a published `MAYORIA` column on the official Junta Electoral
 * results, observed as zero in both 2023 and 2025. It is NOT modeled here:
 * this is an unexercised statutory provision, not a missing feature.
 */

export interface HareQuotaListInput {
  listId: string;
  listName: string;
  votes: number;
}

export const HARE_VOTE_TOTALS_KIND = {
  REPORTED_BREAKDOWN: "reported_breakdown",
  COMBINED_BLANK_AND_ANNULLED: "combined_blank_and_annulled",
  VALID_VOTES_ONLY: "valid_votes_only",
} as const;

export interface HareReportedVoteTotals {
  kind?: typeof HARE_VOTE_TOTALS_KIND.REPORTED_BREAKDOWN;
  totalVotes: number;
  blankVotes: number;
  annulledVotes: number;
}

export interface HareCombinedVoteTotals {
  kind: typeof HARE_VOTE_TOTALS_KIND.COMBINED_BLANK_AND_ANNULLED;
  totalVotes: number;
  combinedBlankAndAnnulledVotes: number;
}

export interface HareValidVotesOnly {
  kind: typeof HARE_VOTE_TOTALS_KIND.VALID_VOTES_ONLY;
  validVotes: number;
}

export type HareQuotaVoteTotals =
  | HareReportedVoteTotals
  | HareCombinedVoteTotals
  | HareValidVotesOnly;

export interface HareSourceCoverageInput {
  unmodeledVotes: number;
}

export interface HareSourceCoverage {
  listedVotes: number;
  unmodeledVotes: number;
  uncoveredVotes: number;
  complete: boolean;
}

export interface HareQuotaInput {
  voteTotals: HareQuotaVoteTotals;
  seatsToFill: number;
  /**
   * The full council/body size, when this election renews only part of a
   * standing body by halves (e.g. Coronel Rosales' 18-seat Concejo
   * Deliberante renewing 9 seats per election, LOM Art. 2/3). When
   * present, `seatsToFill` MUST be exactly half of `councilTotal`.
   */
  councilTotal?: number;
  lists: HareQuotaListInput[];
  sourceCoverage?: HareSourceCoverageInput;
  mayoriaVotes?: number;
}

export type HareSeatAwardReason =
  | "cuociente_division"
  | "largest_remainder"
  | "halving"
  | "tie_break";

export interface HareTieBreak {
  rule: string;
  basis: "statutory" | "simulation_convention";
  citation: string;
}

export interface HareListResult {
  listId: string;
  listName: string;
  votes: number;
  /** Raw quotient (votes / cuociente), unrounded. */
  quotient: number;
  initialSeatsByCuociente: number;
  seatsByCuociente: number;
  seatsByResidue: number;
  totalSeats: number;
  remainder: number;
}

export interface HareHalvingStep {
  iteration: number;
  cuociente: number;
  qualifyingListIds: string[];
}

export interface HareSeatCapTrace {
  availableSeats: number;
  qualifyingListIds: string[];
  awardedListIds: string[];
  excludedListIds: string[];
  tieBreak?: HareTieBreak;
}

export interface HareSeatAward {
  listId: string;
  awardedBy: HareSeatAwardReason;
  values: Record<string, number>;
  tieBreak?: HareTieBreak;
}

export interface HareAllocationResult {
  initialCuociente: number;
  cuociente: number;
  halvingIterations: number;
  halvingSteps: HareHalvingStep[];
  seatCap?: HareSeatCapTrace;
  validVotes: number;
  voteTotals: HareQuotaVoteTotals;
  sourceCoverage?: HareSourceCoverage;
  totalVotes?: number;
  blankVotes?: number;
  annulledVotes?: number;
  combinedBlankAndAnnulledVotes?: number;
  seatsToFill: number;
  results: HareListResult[];
  seatAwards: HareSeatAward[];
  tieBreaks: HareTieBreak[];
}

export class HareQuotaValidationError extends Error {}

export class UnsupportedMayoriaError extends HareQuotaValidationError {
  readonly code = "unsupported_mayoria";

  constructor(votes: number) {
    super(
      `MAYORIA is not implemented from Ley 5109; refusing ${votes} MAYORIA votes before allocation`,
    );
    this.name = "UnsupportedMayoriaError";
  }
}

export function assertMayoriaSupported(mayoriaVotes = 0): void {
  if (mayoriaVotes > 0) throw new UnsupportedMayoriaError(mayoriaVotes);
}

/** Art. 109 final paragraph: valid votes exclude blank and annulled votes. */
export function computeValidVotes(totals: HareQuotaVoteTotals): number {
  if ("validVotes" in totals) return totals.validVotes;
  if ("combinedBlankAndAnnulledVotes" in totals) {
    return totals.totalVotes - totals.combinedBlankAndAnnulledVotes;
  }
  return totals.totalVotes - totals.blankVotes - totals.annulledVotes;
}

const STATUTORY_REMAINDER_TIE_BREAK: HareTieBreak = {
  rule: "Equal remainder resolved by higher raw vote total",
  basis: "statutory",
  citation: "Ley 5109 Art. 109(c)",
};

const CONVENTION_REMAINDER_TIE_BREAK: HareTieBreak = {
  rule: "Equal remainder and equal vote total resolved by lower list id",
  basis: "simulation_convention",
  citation:
    "Ley 5109 Art. 109(c) does not resolve equal remainders with equal vote totals",
};

const CONVENTION_SEAT_CAP_TIE_BREAK: HareTieBreak = {
  rule: "Equal votes at the Art. 110 seat cap resolved by lower list id",
  basis: "simulation_convention",
  citation:
    "Ley 5109 Art. 110 does not resolve equal vote totals at the seat cap",
};

function exactInteger(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new HareQuotaValidationError(`${label} must be a safe integer`);
  }
  return BigInt(value);
}

function getReportedTotals(totals: HareQuotaVoteTotals) {
  if ("validVotes" in totals) return {};
  if ("combinedBlankAndAnnulledVotes" in totals) {
    return {
      totalVotes: totals.totalVotes,
      combinedBlankAndAnnulledVotes: totals.combinedBlankAndAnnulledVotes,
    };
  }
  return {
    totalVotes: totals.totalVotes,
    blankVotes: totals.blankVotes,
    annulledVotes: totals.annulledVotes,
  };
}

export function allocateHareQuota(input: HareQuotaInput): HareAllocationResult {
  assertMayoriaSupported(input.mayoriaVotes);
  if (
    input.councilTotal !== undefined &&
    input.seatsToFill * 2 !== input.councilTotal
  ) {
    throw new HareQuotaValidationError(
      `A half-renewal election must allocate exactly half the council total: ` +
        `${input.seatsToFill} of ${input.councilTotal} seats was supplied.`,
    );
  }

  const validVotes = computeValidVotes(input.voteTotals);
  if (validVotes <= 0) {
    throw new HareQuotaValidationError(
      "a positive valid-vote basis is required after excluding blank and annulled votes",
    );
  }
  if (!input.lists.some((list) => list.votes > 0)) {
    throw new HareQuotaValidationError(
      "no positive-vote list was supplied; refusing a zero-vote allocation",
    );
  }
  const exactValidVotes = exactInteger(validVotes, "validVotes");
  exactInteger(input.seatsToFill, "seatsToFill");
  for (const list of input.lists)
    exactInteger(list.votes, `votes for ${list.listId}`);

  const listedVotes = input.lists.reduce((sum, list) => sum + list.votes, 0);
  if (input.sourceCoverage) {
    exactInteger(input.sourceCoverage.unmodeledVotes, "unmodeledVotes");
    if (input.sourceCoverage.unmodeledVotes < 0) {
      throw new HareQuotaValidationError("unmodeledVotes must be nonnegative");
    }
  }
  const sourceCoverage = input.sourceCoverage
    ? {
        listedVotes,
        unmodeledVotes: input.sourceCoverage.unmodeledVotes,
        uncoveredVotes:
          validVotes - listedVotes - input.sourceCoverage.unmodeledVotes,
        complete: true,
      }
    : undefined;
  if (sourceCoverage && sourceCoverage.uncoveredVotes !== 0) {
    throw new HareQuotaValidationError(
      `source coverage has ${sourceCoverage.uncoveredVotes.toLocaleString("en-US")} uncovered votes`,
    );
  }

  let quotaDivisor = BigInt(input.seatsToFill);
  const initialCuociente = validVotes / Number(quotaDivisor);
  let cuociente = initialCuociente;
  let halvingIterations = 0;
  const halvingSteps: HareHalvingStep[] = [];

  // Art. 110: repeated 50% halving until at least one list qualifies.
  const qualifies = (list: HareQuotaListInput): boolean =>
    BigInt(list.votes) * quotaDivisor >= exactValidVotes;

  while (!input.lists.some(qualifies)) {
    quotaDivisor *= 2n;
    cuociente = validVotes / Number(quotaDivisor);
    halvingIterations += 1;
    halvingSteps.push({
      iteration: halvingIterations,
      cuociente,
      qualifyingListIds: input.lists
        .filter(qualifies)
        .map((list) => list.listId),
    });
  }

  const divisionReason: HareSeatAwardReason =
    halvingIterations > 0 ? "halving" : "cuociente_division";

  const byCuociente = input.lists.map((list) => {
    const scaledVotes = BigInt(list.votes) * quotaDivisor;
    const exactSeats = scaledVotes / exactValidVotes;
    const remainderNumerator = scaledVotes % exactValidVotes;
    const quotient = Number(scaledVotes) / validVotes;
    const seatsByCuociente = Number(exactSeats);
    const remainder = Number(remainderNumerator) / Number(quotaDivisor);
    return {
      list,
      quotient,
      initialSeatsByCuociente: seatsByCuociente,
      seatsByCuociente,
      remainder,
      remainderNumerator,
    };
  });

  const totalByCuociente = byCuociente.reduce(
    (sum, entry) => sum + entry.seatsByCuociente,
    0,
  );

  const seatAwards: HareSeatAward[] = [];
  const tieBreaks: HareTieBreak[] = [];
  const seatsByResidue = new Map<string, number>();

  if (totalByCuociente > input.seatsToFill) {
    // Art. 110 over-subscription: more qualifying lists reached the
    // cuociente than there are seats. Seats go to the highest-voted
    // qualifying lists, capped at one seat each (the division step never
    // produces more than one seat per list once a cap this tight is hit);
    // excess qualifiers receive zero despite technically clearing the bar.
    const qualifying = byCuociente
      .filter((entry) => entry.seatsByCuociente >= 1)
      .sort(
        (a, b) =>
          b.list.votes - a.list.votes ||
          a.list.listId.localeCompare(b.list.listId),
      );
    const awardedListIds = qualifying
      .slice(0, input.seatsToFill)
      .map((entry) => entry.list.listId);
    const qualifyingListIds = new Set(awardedListIds);
    const capBoundaryIsTied =
      qualifying.length > input.seatsToFill &&
      qualifying[input.seatsToFill - 1]?.list.votes ===
        qualifying[input.seatsToFill]?.list.votes;
    const capTieBreak = capBoundaryIsTied
      ? CONVENTION_SEAT_CAP_TIE_BREAK
      : undefined;
    const seatCap: HareSeatCapTrace = {
      availableSeats: input.seatsToFill,
      qualifyingListIds: qualifying.map((entry) => entry.list.listId),
      awardedListIds,
      excludedListIds: qualifying
        .slice(input.seatsToFill)
        .map((entry) => entry.list.listId),
      ...(capTieBreak ? { tieBreak: capTieBreak } : {}),
    };

    const cappedByCuociente = byCuociente.map((entry) => ({
      ...entry,
      seatsByCuociente: qualifyingListIds.has(entry.list.listId) ? 1 : 0,
    }));

    for (const entry of cappedByCuociente) {
      if (entry.seatsByCuociente === 1) {
        const tieBreak =
          capTieBreak &&
          entry.list.listId === awardedListIds[input.seatsToFill - 1]
            ? capTieBreak
            : undefined;
        if (tieBreak) tieBreaks.push(tieBreak);
        seatAwards.push({
          listId: entry.list.listId,
          awardedBy: divisionReason,
          values: { votes: entry.list.votes, cuociente },
          ...(tieBreak ? { tieBreak } : {}),
        });
      }
    }

    return buildResult({
      byCuociente: cappedByCuociente,
      seatsByResidue: new Map(input.lists.map((list) => [list.listId, 0])),
      initialCuociente,
      cuociente,
      halvingIterations,
      halvingSteps,
      seatCap,
      validVotes,
      ...(sourceCoverage ? { sourceCoverage } : {}),
      input,
      seatAwards,
      tieBreaks,
    });
  }

  // Record the base cuociente-division seats as awards.
  for (const entry of byCuociente) {
    for (let seat = 0; seat < entry.seatsByCuociente; seat += 1) {
      seatAwards.push({
        listId: entry.list.listId,
        awardedBy: divisionReason,
        values: { votes: entry.list.votes, cuociente },
      });
    }
  }

  // Art. 109(c): largest-remainder top-up for the leftover seats.
  let remainingSeats = input.seatsToFill - totalByCuociente;
  const remainderOrder = byCuociente
    .filter((entry) => entry.initialSeatsByCuociente > 0)
    .sort((a, b) => {
      if (a.remainderNumerator !== b.remainderNumerator) {
        return a.remainderNumerator > b.remainderNumerator ? -1 : 1;
      }
      // Equal remainder: statutory tie-break, higher raw vote total wins.
      if (a.list.votes !== b.list.votes) {
        return b.list.votes - a.list.votes;
      }
      // Statute is silent when remainder AND votes are both identical.
      // Simulation convention (D4): lower list id wins, never presented as
      // statutory.
      return a.list.listId.localeCompare(b.list.listId);
    });

  for (const entry of remainderOrder) {
    seatsByResidue.set(
      entry.list.listId,
      seatsByResidue.get(entry.list.listId) ?? 0,
    );
  }

  const awardedCount = Math.min(remainingSeats, remainderOrder.length);

  // A tie-break was actually decisive only at the boundary: the last
  // awarded list has the same remainder as the first list that did NOT
  // get a seat. Interior ties (multiple equal remainders that all still
  // receive a seat) never had to be resolved and are not flagged.
  const boundaryIsTied =
    awardedCount > 0 &&
    awardedCount < remainderOrder.length &&
    remainderOrder[awardedCount - 1]!.remainderNumerator ===
      remainderOrder[awardedCount]!.remainderNumerator;

  for (let i = 0; i < awardedCount; i += 1) {
    const entry = remainderOrder[i]!;
    seatsByResidue.set(
      entry.list.listId,
      (seatsByResidue.get(entry.list.listId) ?? 0) + 1,
    );
    const isBoundaryAward = boundaryIsTied && i === awardedCount - 1;
    const runnerUp = remainderOrder[awardedCount];
    const tieBreak = isBoundaryAward
      ? entry.list.votes === runnerUp?.list.votes
        ? CONVENTION_REMAINDER_TIE_BREAK
        : STATUTORY_REMAINDER_TIE_BREAK
      : undefined;
    if (tieBreak) {
      tieBreaks.push(tieBreak);
    }
    seatAwards.push({
      listId: entry.list.listId,
      awardedBy: "largest_remainder",
      values: { votes: entry.list.votes, remainder: entry.remainder },
      ...(tieBreak ? { tieBreak } : {}),
    });
  }

  return buildResult({
    byCuociente,
    seatsByResidue,
    initialCuociente,
    cuociente,
    halvingIterations,
    halvingSteps,
    validVotes,
    ...(sourceCoverage ? { sourceCoverage } : {}),
    input,
    seatAwards,
    tieBreaks,
  });
}

function buildResult(args: {
  byCuociente: Array<{
    list: HareQuotaListInput;
    quotient: number;
    initialSeatsByCuociente: number;
    seatsByCuociente: number;
    remainder: number;
    remainderNumerator: bigint;
  }>;
  seatsByResidue: Map<string, number>;
  initialCuociente: number;
  cuociente: number;
  halvingIterations: number;
  halvingSteps: HareHalvingStep[];
  seatCap?: HareSeatCapTrace;
  validVotes: number;
  sourceCoverage?: HareSourceCoverage;
  input: HareQuotaInput;
  seatAwards: HareSeatAward[];
  tieBreaks: HareTieBreak[];
}): HareAllocationResult {
  const results: HareListResult[] = args.byCuociente.map((entry) => {
    const residue = args.seatsByResidue.get(entry.list.listId) ?? 0;
    return {
      listId: entry.list.listId,
      listName: entry.list.listName,
      votes: entry.list.votes,
      quotient: entry.quotient,
      initialSeatsByCuociente: entry.initialSeatsByCuociente,
      seatsByCuociente: entry.seatsByCuociente,
      seatsByResidue: residue,
      totalSeats: entry.seatsByCuociente + residue,
      remainder: entry.remainder,
    };
  });

  if (args.seatAwards.length !== args.input.seatsToFill) {
    throw new HareQuotaValidationError(
      `cannot allocate all ${args.input.seatsToFill} seats from the supplied lists; ` +
        `only ${args.seatAwards.length} seat awards were produced`,
    );
  }

  return {
    initialCuociente: args.initialCuociente,
    cuociente: args.cuociente,
    halvingIterations: args.halvingIterations,
    halvingSteps: args.halvingSteps,
    ...(args.seatCap ? { seatCap: args.seatCap } : {}),
    validVotes: args.validVotes,
    voteTotals: args.input.voteTotals,
    ...(args.sourceCoverage ? { sourceCoverage: args.sourceCoverage } : {}),
    ...getReportedTotals(args.input.voteTotals),
    seatsToFill: args.input.seatsToFill,
    results,
    seatAwards: args.seatAwards,
    tieBreaks: args.tieBreaks,
  };
}
