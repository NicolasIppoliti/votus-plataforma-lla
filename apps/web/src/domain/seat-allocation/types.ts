import type { z } from "zod";
import type {
  allocationInputSchema,
  nationalInputSchema,
  pbaMunicipalInputSchema,
  pbaProvincialInputSchema,
} from "./schemas";

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

export type AllocationLevel = (typeof ALLOCATION_LEVEL)[keyof typeof ALLOCATION_LEVEL];

export type HareInput =
  | z.infer<typeof pbaMunicipalInputSchema>
  | z.infer<typeof pbaProvincialInputSchema>;

export type DhondtInput = z.infer<typeof nationalInputSchema>;

export type AllocationInput = z.infer<typeof allocationInputSchema>;

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

export interface HareResultListEntry {
  listId: string;
  listName: string;
  votes: number;
  quotient: number;
  seatsByCuociente: number;
  seatsByResidue: number;
  totalSeats: number;
  remainder: number;
}

export interface HareAllocationResult {
  level: "pba_municipal" | "pba_provincial";
  isProjection: boolean;
  cuociente: number;
  halvingIterations: number;
  validVotes: number;
  totalVotes: number;
  blankVotes: number;
  annulledVotes: number;
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
  padron: number;
  thresholdPercent: number;
  thresholdVotes: number;
  seatsToFill: number;
  results: DhondtResultListEntry[];
  seatAwards: SeatAward[];
  quotientTable: DhondtQuotientEntry[];
}

export type AllocationResult = HareAllocationResult | DhondtAllocationResult;
