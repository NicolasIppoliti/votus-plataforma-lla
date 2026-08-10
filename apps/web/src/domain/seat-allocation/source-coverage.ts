export const UNMODELED_VOTE_REASON = {
  OMITTED_NON_QUALIFYING_LISTS: "omitted_non_qualifying_lists",
  OTHER_SOURCE_ROWS: "other_source_rows",
} as const;

export type UnmodeledVoteReason =
  (typeof UNMODELED_VOTE_REASON)[keyof typeof UNMODELED_VOTE_REASON];

export interface UnmodeledVoteBreakdownEntry {
  reason: UnmodeledVoteReason;
  votes: number;
}
