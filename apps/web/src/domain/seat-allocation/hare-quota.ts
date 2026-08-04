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

export interface HareQuotaVoteTotals {
  totalVotes: number;
  blankVotes: number;
  annulledVotes: number;
}

export interface HareQuotaInput {
  voteTotals: HareQuotaVoteTotals;
  seatsToFill: number;
  /**
   * The full council/body size, when this election renews only part of a
   * standing body by halves (e.g. Coronel Rosales' 18-seat Concejo
   * Deliberante renewing 9 seats per election, LOM Art. 2/3). When
   * present, `seatsToFill` MUST differ from `councilTotal` - substituting
   * the full council size for the per-election renewal figure silently
   * doubles the cuociente's divisor.
   */
  councilTotal?: number;
  lists: HareQuotaListInput[];
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
  seatsByCuociente: number;
  seatsByResidue: number;
  totalSeats: number;
  remainder: number;
}

export interface HareSeatAward {
  listId: string;
  awardedBy: HareSeatAwardReason;
  values: Record<string, number>;
  tieBreak?: HareTieBreak;
}

export interface HareAllocationResult {
  cuociente: number;
  halvingIterations: number;
  validVotes: number;
  totalVotes: number;
  blankVotes: number;
  annulledVotes: number;
  seatsToFill: number;
  results: HareListResult[];
  seatAwards: HareSeatAward[];
  tieBreaks: HareTieBreak[];
}

export class HareQuotaValidationError extends Error {}

/** Art. 109 final paragraph: valid votes exclude blank and annulled votes. */
export function computeValidVotes(totals: HareQuotaVoteTotals): number {
  return totals.totalVotes - totals.blankVotes - totals.annulledVotes;
}

const STATUTORY_REMAINDER_TIE_BREAK: HareTieBreak = {
  rule: "Equal remainder resolved by higher raw vote total",
  basis: "statutory",
  citation: "Ley 5109 Art. 109(c)",
};

/**
 * Floating-point comparison tolerance for cuociente/remainder comparisons.
 * The published cuociente figures carry six decimals (e.g. 3.928,777777);
 * a plain `===`/`>=` on doubles risks a spurious tie or a spurious miss
 * from float representation error. 1e-6 is one order of magnitude tighter
 * than the published precision, so it absorbs float noise without masking
 * a genuine ordering difference at the statute's own precision.
 */
const EPSILON = 1e-6;

function isEffectivelyGreaterOrEqual(a: number, b: number): boolean {
  return a - b >= -EPSILON;
}

function isEffectivelyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

export function allocateHareQuota(input: HareQuotaInput): HareAllocationResult {
  if (
    input.councilTotal !== undefined &&
    input.seatsToFill === input.councilTotal
  ) {
    throw new HareQuotaValidationError(
      `seatsToFill (${input.seatsToFill}) equals the council total (${input.councilTotal}). ` +
        "A single election allocates only the seats up for renewal, never the full council.",
    );
  }

  const validVotes = computeValidVotes(input.voteTotals);
  let cuociente = validVotes / input.seatsToFill;
  let halvingIterations = 0;

  // Art. 110: repeated 50% halving until at least one list qualifies.
  while (
    !input.lists.some((list) => isEffectivelyGreaterOrEqual(list.votes, cuociente)) &&
    cuociente > 0
  ) {
    cuociente /= 2;
    halvingIterations += 1;
  }

  const divisionReason: HareSeatAwardReason =
    halvingIterations > 0 ? "halving" : "cuociente_division";

  const byCuociente = input.lists.map((list) => {
    const quotient = list.votes / cuociente;
    const seatsByCuociente = Math.floor(quotient + EPSILON);
    const remainder = list.votes - seatsByCuociente * cuociente;
    return { list, quotient, seatsByCuociente, remainder };
  });

  const totalByCuociente = byCuociente.reduce((sum, entry) => sum + entry.seatsByCuociente, 0);

  const seatAwards: HareSeatAward[] = [];
  const tieBreaks: HareTieBreak[] = [];
  const seatsByResidue = new Map<string, number>();

  if (totalByCuociente > input.seatsToFill) {
    // Art. 110 over-subscription: more qualifying lists reached the
    // cuociente than there are seats. Seats go to the highest-voted
    // qualifying lists, capped at one seat each (the division step never
    // produces more than one seat per list once a cap this tight is hit);
    // excess qualifiers receive zero despite technically clearing the bar.
    const qualifyingListIds = new Set(
      byCuociente
        .filter((entry) => entry.seatsByCuociente >= 1)
        .sort((a, b) => b.list.votes - a.list.votes)
        .slice(0, input.seatsToFill)
        .map((entry) => entry.list.listId),
    );

    const cappedByCuociente = byCuociente.map((entry) => ({
      ...entry,
      seatsByCuociente: qualifyingListIds.has(entry.list.listId) ? 1 : 0,
    }));

    for (const entry of cappedByCuociente) {
      if (entry.seatsByCuociente === 1) {
        seatAwards.push({
          listId: entry.list.listId,
          awardedBy: divisionReason,
          values: { votes: entry.list.votes, cuociente },
        });
      }
    }

    return buildResult({
      byCuociente: cappedByCuociente,
      seatsByResidue: new Map(input.lists.map((list) => [list.listId, 0])),
      cuociente,
      halvingIterations,
      validVotes,
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
  const remainderOrder = [...byCuociente].sort((a, b) => {
    if (!isEffectivelyEqual(a.remainder, b.remainder)) {
      return b.remainder - a.remainder;
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
    seatsByResidue.set(entry.list.listId, seatsByResidue.get(entry.list.listId) ?? 0);
  }

  const awardedCount = Math.min(remainingSeats, remainderOrder.length);

  // A tie-break was actually decisive only at the boundary: the last
  // awarded list has the same remainder as the first list that did NOT
  // get a seat. Interior ties (multiple equal remainders that all still
  // receive a seat) never had to be resolved and are not flagged.
  const boundaryIsTied =
    awardedCount > 0 &&
    awardedCount < remainderOrder.length &&
    isEffectivelyEqual(
      remainderOrder[awardedCount - 1]!.remainder,
      remainderOrder[awardedCount]!.remainder,
    );

  for (let i = 0; i < awardedCount; i += 1) {
    const entry = remainderOrder[i]!;
    seatsByResidue.set(entry.list.listId, (seatsByResidue.get(entry.list.listId) ?? 0) + 1);
    const isBoundaryAward = boundaryIsTied && i === awardedCount - 1;
    const tieBreak = isBoundaryAward ? STATUTORY_REMAINDER_TIE_BREAK : undefined;
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
    cuociente,
    halvingIterations,
    validVotes,
    input,
    seatAwards,
    tieBreaks,
  });
}

function buildResult(args: {
  byCuociente: Array<{ list: HareQuotaListInput; quotient: number; seatsByCuociente: number; remainder: number }>;
  seatsByResidue: Map<string, number>;
  cuociente: number;
  halvingIterations: number;
  validVotes: number;
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
      seatsByCuociente: entry.seatsByCuociente,
      seatsByResidue: residue,
      totalSeats: entry.seatsByCuociente + residue,
      remainder: entry.remainder,
    };
  });

  return {
    cuociente: args.cuociente,
    halvingIterations: args.halvingIterations,
    validVotes: args.validVotes,
    totalVotes: args.input.voteTotals.totalVotes,
    blankVotes: args.input.voteTotals.blankVotes,
    annulledVotes: args.input.voteTotals.annulledVotes,
    seatsToFill: args.input.seatsToFill,
    results,
    seatAwards: args.seatAwards,
    tieBreaks: args.tieBreaks,
  };
}
