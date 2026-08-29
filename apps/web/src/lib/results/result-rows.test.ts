import { describe, expect, it } from "vitest";
import {
  describeExcluded,
  tallyByKind,
  unmappedByListId,
  votesByParty,
} from "./result-rows";
import type { ResultRow } from "./result-rows";

const MIXED_ROWS: ResultRow[] = [
  {
    jurisdictionId: "j1",
    categoryId: "c1",
    listId: "135",
    votes: 100,
    sourceKind: "official",
    granularity: "mesa",
    archiveEntryId: "national/2025-legislativas",
  },
  {
    jurisdictionId: "j1",
    categoryId: "c1",
    listId: "135",
    votes: 9999,
    sourceKind: "fiscalizacion",
    granularity: "mesa",
    archiveEntryId: "fiscalizacion/2025-lla",
  },
];

describe("the exclusion tally (rule 3 — a drop is judged by its size)", () => {
  it("test_the_tally_carries_votes_not_only_a_row_count", () => {
    const response = { excluded: tallyByKind([MIXED_ROWS[1]!]) };

    expect(response.excluded).toEqual({ fiscalizacion: { rows: 1, votes: 9999 } });
    expect(describeExcluded(response.excluded)).toBe("1 fila fiscalización / 9999 votos");
  });

  it("test_a_source_kind_outside_the_enum_lands_in_its_own_bucket", () => {
    const response = {
      excluded: tallyByKind([
        { ...MIXED_ROWS[0]!, votes: 41, sourceKind: "provisional" as ResultRow["sourceKind"] },
      ]),
    };

    expect(response.excluded["unknown"]).toEqual({ rows: 1, votes: 41 });
  });

  it("test_nothing_dropped_renders_no_note_at_all", () => {
    expect(describeExcluded({})).toBeNull();
    // A zero-row entry is not a drop; rendering "0 official row(s)" beside a
    // figure reads as a disclosure when there is nothing to disclose.
    expect(describeExcluded({ official: { rows: 0, votes: 0 } })).toBeNull();
  });
});

describe("votesByParty folds on identity, not on the label", () => {
  const row = (canonicalPartyId: string | null, partyName: string | null, votes: number, listId = "x"): ResultRow => ({
    jurisdictionId: "j1",
    categoryId: "c1",
    listId,
    votes,
    sourceKind: "official",
    granularity: "mesa",
    archiveEntryId: "a1",
    canonicalPartyId,
    partyName,
  });

  it("test_one_party_with_conflicting_names_refuses_in_every_row_order", () => {
    const rows = [
      row("canon-110", "LA LIBERTAD AVANZA", 40),
      row("canon-110", "ALIANZA LA LIBERTAD AVANZA", 60),
    ];
    const expectedError =
      "votesByParty: canonical party canon-110 has conflicting display names: " +
      "ALIANZA LA LIBERTAD AVANZA, LA LIBERTAD AVANZA";

    for (const orderedRows of [rows, [...rows].reverse()]) {
      expect(() => votesByParty(orderedRows)).toThrow(expectedError);
    }
  });

  it("test_two_parties_sharing_a_name_are_not_merged", () => {
    // The other direction: two canonical parties that happen to share a string
    // folded into one number.
    expect(
      votesByParty([row("canon-1", "PARTIDO X", 30), row("canon-2", "PARTIDO X", 20)]),
    ).toEqual([
      { label: "PARTIDO X", votes: 30 },
      { label: "PARTIDO X", votes: 20 },
    ]);
  });

  it("test_unresolved_rows_are_absent_from_the_ranked_list", () => {
    // They have their OWN reported section. Emitting them here too put the same
    // votes in two places, one of them where a reader sums them as a party's figure.
    expect(votesByParty([row(null, null, 700, "4321"), row("canon-1", "PARTIDO X", 30)])).toEqual([
      { label: "PARTIDO X", votes: 30 },
    ]);
    expect(unmappedByListId([row(null, null, 700, "4321")]).entries).toEqual([
      { listId: "4321", rows: 1, votes: 700 },
    ]);
  });
});

describe("unmappedByListId separates the two ways a row has no party", () => {
  const row = (listId: string | null, votes: number): ResultRow => ({
    jurisdictionId: "j1",
    categoryId: "c1",
    listId,
    votes,
    sourceKind: "official",
    granularity: "mesa",
    archiveEntryId: "a1",
    canonicalPartyId: null,
    partyName: null,
  });

  it("test_a_row_with_no_list_id_is_not_a_list_id_that_failed_to_map", () => {
    // Historical persisted rows may legitimately have `list_id: null`; the
    // current source identity comes from `agrupacion_id`, not an empty
    // `lista_numero`. These are non-party rows, and bucketing them under
    // "(no list id)" would report them as ids that failed to map.
    const reading = unmappedByListId([row(null, 40), row("4321", 700)]);

    expect(reading.entries).toEqual([{ listId: "4321", rows: 1, votes: 700 }]);
    // PER SOURCE KIND: one aggregate collapsed distinct historical nullable
    // rows and current POSITIVO rows into a single number.
    expect(reading.withoutListId).toEqual({ official: { rows: 1, votes: 40 } });
    expect(reading.entries.some((entry) => entry.listId === "(no list id)")).toBe(false);
  });

  it("test_an_unresolved_row_with_a_null_list_id_is_disclosed_by_source", () => {
    const reading = unmappedByListId([
      {
        ...row(null, 55),
        canonicalPartyId: "canon-1",
        partyName: null,
      },
    ]);

    expect(reading.entries).toEqual([]);
    expect(reading.withoutListId).toEqual({ official: { rows: 1, votes: 55 } });
  });
});
