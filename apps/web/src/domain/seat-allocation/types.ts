import type { z } from "zod";
import type {
  allocationInputSchema,
  allocationVoteTotalsSchema,
  nationalInputSchema,
  pbaMunicipalInputSchema,
  pbaProvincialInputSchema,
} from "./schemas";
import { ALLOCATION_VOTE_TOTALS_KIND } from "./schemas";

/**
 * Public type surface for the seat-allocation domain (design.md D3).
 * `AllocationInput` is a discriminated union on `level`: a PBA variant
 * (`HareInput`) has NO `threshold` field, and the national variant
 * (`DhondtInput`) has NO `cuociente` field. Applying the wrong method to
 * a level is therefore a COMPILE error (see `allocate.test-d.ts`), backed
 * at runtime by `schemas.ts`'s `z.strictObject` rejection of unknown keys.
 *
 * Input types are derived via `z.infer` so the schema stays the single
 * source of truth; only the output (`AllocationResult`) is hand-written,
 * since it is never parsed.
 */

export const ALLOCATION_LEVEL = {
  PBA_MUNICIPAL: "pba_municipal",
  PBA_PROVINCIAL: "pba_provincial",
  NATIONAL: "national",
} as const;

export type AllocationLevel =
  (typeof ALLOCATION_LEVEL)[keyof typeof ALLOCATION_LEVEL];

export type HareInput =
  | z.infer<typeof pbaMunicipalInputSchema>
  | z.infer<typeof pbaProvincialInputSchema>;

export type DhondtInput = z.infer<typeof nationalInputSchema>;

export type AllocationInput = z.infer<typeof allocationInputSchema>;

export interface ReportedAllocationVoteTotals {
  kind: typeof ALLOCATION_VOTE_TOTALS_KIND.REPORTED_BREAKDOWN;
  totalVotes: number;
  blankVotes: number;
  annulledVotes: number;
}

export type AllocationVoteTotals =
  | ReportedAllocationVoteTotals
  | z.infer<typeof allocationVoteTotalsSchema>;

export interface TieBreak {
  rule: string;
  basis: "statutory" | "simulation_convention";
  citation: string;
}

export type SeatAwardReason =
  | "cuociente_division"
  | "largest_remainder"
  | "halving"
  | "dhondt_quotient"
  | "tie_break";

export interface SeatAward {
  listId: string;
  awardedBy: SeatAwardReason;
  values: Record<string, number>;
  tieBreak?: TieBreak;
}

export interface VoteCoverage {
  basisVotes: number;
  listedVotes: number;
  unmodeledVotes: number;
  uncoveredVotes: number;
  complete: boolean;
}

export const THRESHOLD_POLICY = {
  STATUTORY: "statutory",
  SCENARIO: "scenario_policy",
} as const;

export type ThresholdPolicy =
  (typeof THRESHOLD_POLICY)[keyof typeof THRESHOLD_POLICY];

export interface HareResultListEntry {
  listId: string;
  listName: string;
  votes: number;
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
  tieBreak?: TieBreak;
}

export interface HareAllocationResult {
  level: "pba_municipal" | "pba_provincial";
  isProjection: boolean;
  coverage: VoteCoverage;
  initialCuociente: number;
  cuociente: number;
  halvingIterations: number;
  halvingSteps: HareHalvingStep[];
  seatCap?: HareSeatCapTrace;
  validVotes: number;
  voteTotals: AllocationVoteTotals;
  totalVotes?: number;
  blankVotes?: number;
  annulledVotes?: number;
  combinedBlankAndAnnulledVotes?: number;
  seatsToFill: number;
  results: HareResultListEntry[];
  seatAwards: SeatAward[];
  tieBreaks: TieBreak[];
}

export interface DhondtResultListEntry {
  listId: string;
  listName: string;
  votes: number;
  votingSharePercent: number;
  excludedByThreshold: boolean;
  seats: number;
}

export interface DhondtQuotientEntry {
  listId: string;
  divisor: number;
  quotient: number;
}

export interface DhondtAllocationResult {
  level: "national";
  isProjection: boolean;
  coverage: VoteCoverage;
  padron: number;
  totalVotes: number;
  thresholdPercent: number;
  thresholdPolicy: ThresholdPolicy;
  thresholdVotes: number;
  seatsToFill: number;
  results: DhondtResultListEntry[];
  seatAwards: SeatAward[];
  quotientTable: DhondtQuotientEntry[];
}

export type AllocationResult = HareAllocationResult | DhondtAllocationResult;
