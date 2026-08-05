/**
 * The ONLY public entry point of the seat-allocation domain (design.md
 * D3). `hare-quota.ts` and `dhondt.ts` MUST NOT be imported by anything
 * outside this directory - go through `allocateSeats` instead.
 *
 * The allocation method is selected purely by `input.level`; there is no
 * `method` parameter anywhere in `AllocationInput`, so an operator can
 * never override the statutory method for a level (spec.md "Allocation
 * method is selected by level, not configuration").
 */

import type { DhondtSeatAward } from "./dhondt";
import { allocateDhondt } from "./dhondt";
import type { HareSeatAward } from "./hare-quota";
import { allocateHareQuota } from "./hare-quota";
import { allocationInputSchema } from "./schemas";
import type { AllocationInput, AllocationResult, SeatAward } from "./types";

function toPublicSeatAward(award: HareSeatAward | DhondtSeatAward): SeatAward {
  return {
    listId: award.listId,
    awardedBy: award.awardedBy,
    values: award.values,
    ...(award.tieBreak ? { tieBreak: award.tieBreak } : {}),
  };
}

export function allocateSeats(rawInput: AllocationInput): AllocationResult {
  // Runtime boundary: rejects any unrecognized key (e.g. a `threshold` on
  // a PBA payload) rather than silently ignoring it (spec.md, D5).
  const input = allocationInputSchema.parse(rawInput);
  const isProjection = input.isProjection ?? false;

  if (input.level === "national") {
    const result = allocateDhondt({
      padron: input.padron,
      thresholdPercent: input.threshold.value,
      seatsToFill: input.seatsToFill,
      lists: input.lists,
    });

    return {
      level: "national",
      isProjection,
      padron: result.padron,
      thresholdPercent: result.thresholdPercent,
      thresholdVotes: result.thresholdVotes,
      seatsToFill: result.seatsToFill,
      results: result.results,
      seatAwards: result.seatAwards.map(toPublicSeatAward),
      quotientTable: result.quotientTable,
    };
  }

  const result = allocateHareQuota({
    voteTotals: {
      totalVotes: input.totalVotes,
      blankVotes: input.blankVotes,
      annulledVotes: input.annulledVotes,
    },
    seatsToFill: input.seatsToFill,
    ...(input.councilTotal !== undefined ? { councilTotal: input.councilTotal } : {}),
    lists: input.lists,
  });

  return {
    level: input.level,
    isProjection,
    cuociente: result.cuociente,
    halvingIterations: result.halvingIterations,
    validVotes: result.validVotes,
    totalVotes: result.totalVotes,
    blankVotes: result.blankVotes,
    annulledVotes: result.annulledVotes,
    seatsToFill: result.seatsToFill,
    results: result.results,
    seatAwards: result.seatAwards.map(toPublicSeatAward),
    tieBreaks: result.tieBreaks,
  };
}
