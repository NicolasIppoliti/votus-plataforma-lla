import { z } from "zod";

/**
 * Runtime boundary for `AllocationInput` (design.md D3). Every variant is
 * a `z.strictObject`, so an unrecognized key (e.g. a `threshold` on a PBA
 * payload) is a REJECTION at parse time, never a silent ignore - this is
 * the runtime half of the compile-time discriminated-union enforcement in
 * `types.ts`.
 */

export const allocationListSchema = z.strictObject({
  listId: z.string().min(1),
  listName: z.string().min(1),
  votes: z.number().int().nonnegative(),
});

const hareFields = {
  totalVotes: z.number().int().nonnegative(),
  blankVotes: z.number().int().nonnegative(),
  annulledVotes: z.number().int().nonnegative(),
  seatsToFill: z.number().int().positive(),
  /** Only present when this election renews half of a standing council. */
  councilTotal: z.number().int().positive().optional(),
  lists: z.array(allocationListSchema).min(1),
  isProjection: z.boolean().optional(),
};

export const pbaMunicipalInputSchema = z.strictObject({
  level: z.literal("pba_municipal"),
  ...hareFields,
});

export const pbaProvincialInputSchema = z.strictObject({
  level: z.literal("pba_provincial"),
  ...hareFields,
});

export const nationalInputSchema = z.strictObject({
  level: z.literal("national"),
  padron: z.number().int().positive(),
  /** Basis is always the padron (Art. 160), never valid votes. */
  threshold: z.strictObject({
    value: z.number().nonnegative(),
    basis: z.literal("padron"),
  }),
  seatsToFill: z.number().int().positive(),
  lists: z.array(allocationListSchema).min(1),
  isProjection: z.boolean().optional(),
});

export const allocationInputSchema = z.discriminatedUnion("level", [
  pbaMunicipalInputSchema,
  pbaProvincialInputSchema,
  nationalInputSchema,
]);
