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
import {
  allocateHareQuota,
  assertMayoriaSupported,
  computeValidVotes,
  HARE_VOTE_TOTALS_KIND,
  type HareQuotaVoteTotals,
  type HareSeatAward,
} from "./hare-quota";
import { allocationInputSchema } from "./schemas";
import {
  THRESHOLD_POLICY,
  type AllocationInput,
  type AllocationResult,
  type AllocationVoteTotals,
  type SeatAward,
  type VoteCoverage,
} from "./types";

function reconcileCoverage(
  basisVotes: number,
  listedVotes: number,
  unmodeledVotes: number,
  isProjection: boolean,
): VoteCoverage {
  const uncoveredVotes = basisVotes - listedVotes - unmodeledVotes;
  if (uncoveredVotes < 0) {
    throw new Error(
      "listed and unmodeled votes exceed the vote-coverage basis",
    );
  }
  if (!isProjection && uncoveredVotes > 0) {
    throw new Error(
      `historical simulation has ${uncoveredVotes} uncovered votes; complete coverage is required`,
    );
  }
  return {
    basisVotes,
    listedVotes,
    unmodeledVotes,
    uncoveredVotes,
    complete: uncoveredVotes === 0,
  };
}

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
  const isProjection = input.isProjection;
  if (input.level !== "national") assertMayoriaSupported(input.mayoriaVotes);
  const listedVotes = input.lists.reduce((sum, list) => sum + list.votes, 0);

  if (input.level === "national") {
    if (input.totalVotes > input.padron) {
      throw new Error("national totalVotes cannot exceed the padrón");
    }
    if (!isProjection && input.threshold.value !== 3) {
      throw new Error(
        "historical national simulations require the statutory 3% padrón threshold",
      );
    }
    const coverage = reconcileCoverage(
      input.totalVotes,
      listedVotes,
      input.unmodeledVotes,
      isProjection,
    );
    const result = allocateDhondt({
      padron: input.padron,
      thresholdPercent: input.threshold.value,
      seatsToFill: input.seatsToFill,
      lists: input.lists,
    });

    return {
      level: "national",
      isProjection,
      coverage,
      padron: result.padron,
      totalVotes: input.totalVotes,
      thresholdPercent: result.thresholdPercent,
      thresholdPolicy: isProjection
        ? THRESHOLD_POLICY.SCENARIO
        : THRESHOLD_POLICY.STATUTORY,
      thresholdVotes: result.thresholdVotes,
      seatsToFill: result.seatsToFill,
      results: result.results,
      seatAwards: result.seatAwards.map(toPublicSeatAward),
      quotientTable: result.quotientTable,
    };
  }

  const voteTotals: AllocationVoteTotals = input.voteTotals ?? {
    kind: HARE_VOTE_TOTALS_KIND.REPORTED_BREAKDOWN,
    totalVotes: input.totalVotes!,
    blankVotes: input.blankVotes!,
    annulledVotes: input.annulledVotes!,
  };
  const validVotes = computeValidVotes(voteTotals as HareQuotaVoteTotals);
  const coverage = reconcileCoverage(
    validVotes,
    listedVotes,
    input.unmodeledVotes,
    isProjection,
  );

  const result = allocateHareQuota({
    voteTotals: {
      ...voteTotals,
    },
    ...(coverage.complete
      ? { sourceCoverage: { unmodeledVotes: input.unmodeledVotes } }
      : {}),
    ...(input.mayoriaVotes !== undefined
      ? { mayoriaVotes: input.mayoriaVotes }
      : {}),
    seatsToFill: input.seatsToFill,
    ...(input.councilTotal !== undefined
      ? { councilTotal: input.councilTotal }
      : {}),
    lists: input.lists,
  });

  return {
    level: input.level,
    isProjection,
    coverage,
    initialCuociente: result.initialCuociente,
    cuociente: result.cuociente,
    halvingIterations: result.halvingIterations,
    halvingSteps: result.halvingSteps,
    ...(result.seatCap ? { seatCap: result.seatCap } : {}),
    validVotes: result.validVotes,
    voteTotals,
    ...(result.totalVotes !== undefined
      ? { totalVotes: result.totalVotes }
      : {}),
    ...(result.blankVotes !== undefined
      ? { blankVotes: result.blankVotes }
      : {}),
    ...(result.annulledVotes !== undefined
      ? { annulledVotes: result.annulledVotes }
      : {}),
    ...(result.combinedBlankAndAnnulledVotes !== undefined
      ? {
          combinedBlankAndAnnulledVotes: result.combinedBlankAndAnnulledVotes,
        }
      : {}),
    seatsToFill: result.seatsToFill,
    results: result.results,
    seatAwards: result.seatAwards.map(toPublicSeatAward),
    tieBreaks: result.tieBreaks,
  };
}
