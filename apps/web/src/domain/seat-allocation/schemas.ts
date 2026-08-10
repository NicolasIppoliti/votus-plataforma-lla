import { z } from "zod";
import { UNMODELED_VOTE_REASON } from "./source-coverage";

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

export const ALLOCATION_VOTE_TOTALS_KIND = {
  REPORTED_BREAKDOWN: "reported_breakdown",
  COMBINED_BLANK_AND_ANNULLED: "combined_blank_and_annulled",
  VALID_VOTES_ONLY: "valid_votes_only",
} as const;

export const unmodeledVoteBreakdownEntrySchema = z.strictObject({
  reason: z.enum([
    UNMODELED_VOTE_REASON.OMITTED_NON_QUALIFYING_LISTS,
    UNMODELED_VOTE_REASON.OTHER_SOURCE_ROWS,
  ]),
  votes: z.number().int().positive(),
});

const unmodeledVoteBreakdownSchema = z
  .array(unmodeledVoteBreakdownEntrySchema)
  .refine(
    (entries) =>
      new Set(entries.map((entry) => entry.reason)).size === entries.length,
    { message: "unmodeled vote reasons must be unique" },
  );

export const allocationVoteTotalsSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal(ALLOCATION_VOTE_TOTALS_KIND.COMBINED_BLANK_AND_ANNULLED),
    totalVotes: z.number().int().nonnegative(),
    combinedBlankAndAnnulledVotes: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal(ALLOCATION_VOTE_TOTALS_KIND.VALID_VOTES_ONLY),
    validVotes: z.number().int().positive(),
  }),
]);

const allocationListsSchema = z
  .array(allocationListSchema)
  .min(1)
  .refine(
    (lists) => new Set(lists.map((list) => list.listId)).size === lists.length,
    {
      message: "duplicate listId values are not allowed",
    },
  );

const hareFields = {
  totalVotes: z.number().int().nonnegative().optional(),
  blankVotes: z.number().int().nonnegative().optional(),
  annulledVotes: z.number().int().nonnegative().optional(),
  voteTotals: allocationVoteTotalsSchema.optional(),
  seatsToFill: z.number().int().positive(),
  /** Only present when this election renews half of a standing council. */
  councilTotal: z.number().int().positive().optional(),
  unmodeledVotes: z.number().int().nonnegative(),
  unmodeledVoteBreakdown: unmodeledVoteBreakdownSchema,
  mayoriaVotes: z.number().int().nonnegative().optional(),
  lists: allocationListsSchema,
  isProjection: z.boolean(),
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
  totalVotes: z.number().int().nonnegative(),
  unmodeledVotes: z.number().int().nonnegative(),
  unmodeledVoteBreakdown: unmodeledVoteBreakdownSchema,
  /** Basis is always the padron (Art. 160), never valid votes. */
  threshold: z.strictObject({
    value: z.number().nonnegative(),
    basis: z.literal("padron"),
  }),
  seatsToFill: z.number().int().positive(),
  lists: allocationListsSchema,
  isProjection: z.boolean(),
});

export const allocationInputSchema = z
  .discriminatedUnion("level", [
    pbaMunicipalInputSchema,
    pbaProvincialInputSchema,
    nationalInputSchema,
  ])
  .superRefine((input, context) => {
    const breakdownVotes = input.unmodeledVoteBreakdown.reduce(
      (sum, entry) => sum + BigInt(entry.votes),
      0n,
    );
    if (breakdownVotes !== BigInt(input.unmodeledVotes)) {
      context.addIssue({
        code: "custom",
        path: ["unmodeledVoteBreakdown"],
        message:
          `unmodeled vote breakdown sums to ${breakdownVotes} but ` +
          `unmodeledVotes is ${input.unmodeledVotes}`,
      });
    }
    if (input.level === "national") return;
    const flatValues = [
      input.totalVotes,
      input.blankVotes,
      input.annulledVotes,
    ];
    const flatCount = flatValues.filter((value) => value !== undefined).length;
    const hasEvidence = input.voteTotals !== undefined;
    if ((flatCount === 3) === hasEvidence || (flatCount > 0 && hasEvidence)) {
      context.addIssue({
        code: "custom",
        message:
          "provide exactly one PBA vote-total shape: totalVotes/blankVotes/annulledVotes or voteTotals evidence",
      });
    }
  });
