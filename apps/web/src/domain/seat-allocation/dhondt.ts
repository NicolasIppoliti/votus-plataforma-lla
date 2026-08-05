/**
 * D'Hondt - Codigo Electoral Nacional, Ley 19.945, Art. 161. National
 * diputados only. This module is deliberately MODULE-PRIVATE (design.md
 * D3): it MUST only ever be imported by `allocate.ts` in this directory.
 * Pure function over plain numbers, no I/O.
 *
 * Art. 160 (per Ley 24.444): a list needs at least 3% of the padron
 *   electoral del distrito to participate - the basis is the PADRON, not
 *   valid votes.
 * Art. 161(a): each qualifying list's votes divided by 1, 2, 3, ... up to
 *   the seat count.
 * Art. 161(b): quotients ordered highest to lowest, independent of list.
 * Art. 161(c): equal quotients ordered by raw vote total - STATUTORY. If
 *   votes are also equal, the statute resolves it by sorteo, which this
 *   system does not perform; the deterministic fallback used instead MUST
 *   be labelled a simulation convention, never a reproduction of statute.
 */

export interface DhondtListInput {
  listId: string;
  listName: string;
  votes: number;
}

export interface DhondtInput {
  padron: number;
  /** Percentage of the padron a list must reach to qualify (Art. 160). */
  thresholdPercent: number;
  seatsToFill: number;
  lists: DhondtListInput[];
}

export interface DhondtTieBreak {
  rule: string;
  basis: "statutory" | "simulation_convention";
  citation: string;
}

export interface DhondtSeatAward {
  listId: string;
  awardedBy: "dhondt_quotient";
  values: Record<string, number>;
  tieBreak?: DhondtTieBreak;
}

export interface DhondtQuotientEntry {
  listId: string;
  divisor: number;
  quotient: number;
}

export interface DhondtListResult {
  listId: string;
  listName: string;
  votes: number;
  /** Raw vote share of the padron, reported even when excluded. */
  votingSharePercent: number;
  excludedByThreshold: boolean;
  seats: number;
}

export interface DhondtAllocationResult {
  padron: number;
  thresholdPercent: number;
  thresholdVotes: number;
  seatsToFill: number;
  results: DhondtListResult[];
  seatAwards: DhondtSeatAward[];
  quotientTable: DhondtQuotientEntry[];
}

/**
 * Floating-point comparison tolerance for quotient ties. Votes and
 * divisors here are always integers, so quotient noise is bounded far
 * below typical float epsilon accumulation; 1e-9 catches representation
 * error without masking a genuine ordering difference.
 */
const EPSILON = 1e-9;

function isEffectivelyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

const STATUTORY_QUOTIENT_TIE_BREAK: DhondtTieBreak = {
  rule: "Equal quotient resolved by higher raw vote total",
  basis: "statutory",
  citation: "Ley 19.945 Art. 161(c) first clause",
};

const CONVENTION_QUOTIENT_TIE_BREAK: DhondtTieBreak = {
  rule: "Equal quotient and equal vote total resolved by lower list id",
  basis: "simulation_convention",
  citation:
    "Ley 19.945 Art. 161(c) resolves this case by sorteo, which the system does not perform",
};

export function allocateDhondt(input: DhondtInput): DhondtAllocationResult {
  const thresholdVotes = input.padron * (input.thresholdPercent / 100);

  const results: DhondtListResult[] = input.lists.map((list) => ({
    listId: list.listId,
    listName: list.listName,
    votes: list.votes,
    votingSharePercent: (list.votes / input.padron) * 100,
    excludedByThreshold: list.votes < thresholdVotes,
    seats: 0,
  }));

  const qualifying = input.lists.filter((list) => list.votes >= thresholdVotes);

  const quotientTable: DhondtQuotientEntry[] = qualifying.flatMap((list) =>
    Array.from({ length: input.seatsToFill }, (_, i) => {
      const divisor = i + 1;
      return { listId: list.listId, divisor, quotient: list.votes / divisor };
    }),
  );

  const votesByListId = new Map(input.lists.map((list) => [list.listId, list.votes]));

  const ordered = [...quotientTable].sort((a, b) => {
    if (!isEffectivelyEqual(a.quotient, b.quotient)) {
      return b.quotient - a.quotient;
    }
    const votesA = votesByListId.get(a.listId) ?? 0;
    const votesB = votesByListId.get(b.listId) ?? 0;
    if (votesA !== votesB) {
      return votesB - votesA;
    }
    // Equal quotient AND equal votes: statute ends in sorteo (not
    // performed). Deterministic convention fallback: lower list id.
    return a.listId.localeCompare(b.listId);
  });

  const seatAwards: DhondtSeatAward[] = [];
  const seatsByListId = new Map<string, number>();

  const awardedCount = Math.min(input.seatsToFill, ordered.length);

  // A tie-break was decisive only at the boundary: the last awarded
  // quotient equals the first quotient that did NOT win a seat. Interior
  // ties among already-awarded seats never had to be resolved.
  const boundaryIsTied =
    awardedCount > 0 &&
    awardedCount < ordered.length &&
    isEffectivelyEqual(ordered[awardedCount - 1]!.quotient, ordered[awardedCount]!.quotient);

  for (let i = 0; i < awardedCount; i += 1) {
    const entry = ordered[i]!;
    seatsByListId.set(entry.listId, (seatsByListId.get(entry.listId) ?? 0) + 1);

    let tieBreak: DhondtTieBreak | undefined;
    if (boundaryIsTied && i === awardedCount - 1) {
      const votesWinner = votesByListId.get(entry.listId) ?? 0;
      const votesRunnerUp = votesByListId.get(ordered[awardedCount]!.listId) ?? 0;
      tieBreak =
        votesWinner === votesRunnerUp
          ? CONVENTION_QUOTIENT_TIE_BREAK
          : STATUTORY_QUOTIENT_TIE_BREAK;
    }

    seatAwards.push({
      listId: entry.listId,
      awardedBy: "dhondt_quotient",
      values: { quotient: entry.quotient, divisor: entry.divisor },
      ...(tieBreak ? { tieBreak } : {}),
    });
  }

  for (const result of results) {
    result.seats = seatsByListId.get(result.listId) ?? 0;
  }

  return {
    padron: input.padron,
    thresholdPercent: input.thresholdPercent,
    thresholdVotes,
    seatsToFill: input.seatsToFill,
    results,
    seatAwards,
    quotientTable,
  };
}
