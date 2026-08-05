import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import type { Coverage, Granularity, SourceKind, SourceRef } from "@/lib/results/types";

/**
 * `ResultsRepository` — the database seam for `results-analysis` and the
 * D9.1 threat-matrix control (design.md, "Unofficial-source leakage into
 * official figures"). Every read goes through this module rather than a
 * page issuing its own query, so the default `source_kind = 'official'`
 * filter is enforced in exactly one place — a page that queried Postgres
 * directly could forget it; a page that only ever calls `queryOfficial` /
 * `aggregateOfficialVotes` structurally cannot leak fiscalización data.
 *
 * `queryFiscalizacion` is the ONLY path that can ever return fiscalización
 * rows, and it is refused outright without an explicit `Coverage` opt-in
 * (D9.2). The two source kinds are never merged into one figure: there is
 * no method that returns both together (D9.1).
 *
 * Fiscalización has no Postgres loader yet (a forward gap already recorded
 * for `etl/etl/ingest/fiscalizacion.py` — see design.md 9.1/9.4 and the
 * Phase 8 migration notes). This repository correctly enforces the filter
 * and the opt-in contract; it does not fabricate data that has not been
 * loaded. `SupabaseRowSource` reads exactly what `result_row` contains.
 */

export interface ResultRow {
  jurisdictionId: string;
  categoryId: string;
  listId: string | null;
  votes: number;
  sourceKind: SourceKind;
  granularity: Granularity;
  archiveEntryId: string;
  /**
   * The curated `party_mapping` -> `party_canonical` display name for
   * `listId` (task 15.14). Explicitly `null` when no `PartyNameSource` was
   * supplied, or when the exact `(year, jurisdiction, category, listId)`
   * key has no curated mapping entry — an unmapped list id MUST surface as
   * this defined `null` "unmapped" state, never as a bare `listId` a page
   * renders as if it were a name (party-identity-mapping spec, "Query
   * encounters an unmapped list id"). Optional so every pre-existing
   * `ResultRow` fixture across the codebase stays valid without an update;
   * `ResultsRepository.resolvePartyNames` always sets it explicitly (to a
   * name or to `null`) on every row it returns.
   */
  partyName?: string | null;
  /**
   * The canonical party this row's list id maps to, or `null` when unmapped.
   *
   * THE identity across years. `partyName` is a DISPLAY string: the curated
   * file spells one canonical party "LA LIBERTAD AVANZA" in 2023 and "ALIANZA
   * LA LIBERTAD AVANZA" in 2025, so comparing on it fabricates a flip exactly
   * the way comparing on the raw list id did.
   */
  canonicalPartyId?: string | null;
}

/**
 * The `(year, jurisdiction, category)` scope `party_mapping`'s curated key
 * needs beyond what `BaseQuery` already carries as opaque database ids —
 * `jurisdiction`/`category` there are curated free-text labels (e.g.
 * `"national"`, `"DIPUTADO NACIONAL"`), a different namespace from the
 * `jurisdiction`/`category` UUID foreign keys `BaseQuery` uses, so a
 * caller that already knows this context (a route like
 * `/fiscalizacion`, which is always about one named election) supplies it
 * explicitly rather than the repository trying to infer it.
 */
export interface PartyMappingContext {
  year: number;
  jurisdiction: string;
  category: string;
}

/** A list id resolved to its curated party. */
export interface ResolvedParty {
  canonicalPartyId: string;
  displayName: string;
}

export interface PartyNameSource {
  fetchPartyNames(
    context: PartyMappingContext,
    listIds: string[],
  ): Promise<Map<string, ResolvedParty>>;
}

export interface BaseQuery {
  electionId: string;
  jurisdictionId: string;
  categoryId: string;
}

export interface RowSource {
  fetchRows(query: BaseQuery): Promise<ResultRow[]>;
}

export interface UnofficialOptIn {
  coverage: Coverage;
}

/**
 * A drop, counted in BOTH the units it can be judged in.
 *
 * A row count alone made a 6.462.906-vote drop and a 6-vote drop render
 * identically, and the size of what vanished is the whole question — the
 * sibling tallies (`foreignByKind`, `unmappedByListId`) already carried votes
 * for exactly this reason.
 */
export type ExcludedByKind = Record<string, { rows: number; votes: number }>;

/**
 * ONE phrasing of a drop, so the four surfaces cannot drift apart again.
 * `null` when nothing was dropped — callers render no note at all.
 */
export function describeExcluded(excluded: ExcludedByKind): string | null {
  const entries = Object.entries(excluded).filter(([, tally]) => tally.rows > 0);
  if (entries.length === 0) return null;
  return entries
    .map(([kind, tally]) => `${tally.rows} ${kind} row(s) / ${tally.votes} vote(s)`)
    .join(", ");
}

/**
 * Foreign rows tallied the same way an exclusion is, so the ONE phrasing in
 * `describeExcluded` covers this refusal too.
 *
 * A bare "3 of 400 rows are not official" made a leaked `fiscalizacion` row and
 * a leaked `unknown`-kind row read identically and never showed the votes —
 * the large-plausible-total shape rule 3 names.
 */
export function tallyByKind(rows: ResultRow[]): ExcludedByKind {
  const tally: ExcludedByKind = {};
  for (const row of rows) {
    const key =
      row.sourceKind === "official" || row.sourceKind === "fiscalizacion"
        ? row.sourceKind
        : "unknown";
    const current = tally[key] ?? { rows: 0, votes: 0 };
    tally[key] = { rows: current.rows + 1, votes: current.votes + row.votes };
  }
  return tally;
}

/**
 * Per-party totals, ranked. ONE fold.
 *
 * `result_row` holds one row per `(mesa, list)`, so rendering rows verbatim
 * printed the same party N times with N different numbers — and three pages
 * each carried an identical copy of this Map fold, including the
 * `unmapped (list …)` label. A rule-4 fix to how an unresolved list id is
 * shown would have landed in one of the three.
 */
export function votesByParty(rows: ResultRow[]): { label: string; votes: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    // NEVER the bare list id: `110` on its own reads as a party called 110.
    const label = row.partyName ?? `unmapped (list ${row.listId ?? "?"})`;
    totals.set(label, (totals.get(label) ?? 0) + row.votes);
  }
  return [...totals.entries()]
    .map(([label, votes]) => ({ label, votes }))
    .sort((a, b) => b.votes - a.votes);
}

export type OkResultsQueryResponse = {
      status: "ok";
      rows: ResultRow[];
      /**
       * Rows the source-kind filter removed, per kind — including `unknown`
       * for a value outside the enum, which both filters drop and which would
       * otherwise appear on no path at all.
       */
  excluded: ExcludedByKind;
};

// No `ResultsQueryResponse` union: with `queryOfficial` and
// `queryFiscalizacion` both narrowed to `OkResultsQueryResponse`, the
// opt-in-refusal member had no producer and no consumer — a status pages
// still had to branch on for a state nothing could reach.

export interface AggregateVotes {
  totalVotes: number;
  sourceKind: "official";
  /**
   * What THIS path's filter dropped, per kind.
   *
   * Path 2 fetches independently, so path 1's breakdown describes a different
   * read: if the two disagree — RLS scope, a mid-write, a different row set —
   * a note built from path 1 would describe rows that are not in this total.
   */
  excluded: ExcludedByKind;
  /**
   * What `totalVotes` was ACTUALLY summed from, per kind.
   *
   * Reports the summed rows themselves rather than re-applying the filter to
   * them: `official.filter((r) => r.sourceKind !== "official")` answered `{}`
   * for every possible input, so the guard reading it was unreachable and the
   * inflated total would have rendered anyway. Derived from one collection, so
   * a change to what gets summed moves this too, and a caller can see a kind
   * it did not expect.
   */
  summedByKind: ExcludedByKind;
}

export class ResultsRepository {
  constructor(
    private readonly rowSource: RowSource,
    private readonly partyNameSource?: PartyNameSource,
  ) {}

  /**
   * Every row the source-kind filter removed, per kind.
   *
   * `source_kind` is read from the database without validation, so a row
   * carrying a third or NULL value is excluded by BOTH `queryOfficial` and
   * `queryFiscalizacion` and appears nowhere at all — the silent-drop shape
   * rule 3 exists for. Counting it here is what makes it visible.
   */
  private static excludedByKind(
    rows: ResultRow[],
    kept: SourceKind,
  ): ExcludedByKind {
    // Delegates: this IS `tallyByKind` over the rows the filter removed, and
    // writing the `official | fiscalizacion | unknown` bucketing twice in one
    // file meant a third `SourceKind` had to be added in two places.
    return tallyByKind(rows.filter((row) => row.sourceKind !== kept));
  }

  /** Path 1 of the threat matrix: the default query. */
  /**
   * Always resolves `ok`. The return type says so: this method has no refusal
   * path, and typing it as the wider `ResultsQueryResponse` made three pages
   * carry a `status !== "ok"` branch that nothing can reach. A denied read
   * THROWS from `fetchRows`; that is the path callers must handle.
   */
  async queryOfficial(
    query: BaseQuery,
    partyContext?: PartyMappingContext,
  ): Promise<OkResultsQueryResponse> {
    const rows = await this.rowSource.fetchRows(query);
    const official = rows.filter((row) => row.sourceKind === "official");
    return {
      status: "ok",
      rows: await this.resolvePartyNames(official, partyContext),
      excluded: ResultsRepository.excludedByKind(rows, "official"),
    };
  }

  /** Path 2 of the threat matrix: any aggregate built on top of a query. */
  async aggregateOfficialVotes(query: BaseQuery): Promise<AggregateVotes> {
    // ITS OWN fetch and ITS OWN filter. Delegating to `queryOfficial` made
    // this path a caller of path 1, so blocking one blocked all and unblocking
    // one unblocked all -- the opposite of the three independent guards D9.1
    // describes, and the reason its test passed while exercising path 1 twice.
    const rows = await this.rowSource.fetchRows(query);
    const summed = rows.filter((row) => row.sourceKind === "official");
    const totalVotes = summed.reduce((sum: number, row: ResultRow) => sum + row.votes, 0);
    return {
      totalVotes,
      sourceKind: "official",
      excluded: ResultsRepository.excludedByKind(rows, "official"),
      // ONE collection: `summed` is what `totalVotes` came from, so widening
      // the filter shows up here as a kind the caller never asked for.
      summedByKind: tallyByKind(summed),
    };
  }

  /**
   * The only path that can return fiscalización rows (D9.2). Every
   * fiscalización aggregate MUST carry its coverage denominator, and
   * `Coverage.isRandomSample` is the literal `false`.
   */
  /**
   * The opt-in is REQUIRED, so this method has no refusal. The compiler
   * enforces what a runtime status only reported: fiscalización is
   * party-internal, unofficial and partial coverage (93/153 mesas — not a
   * random sample), and no caller may read a row without carrying the Coverage
   * figure that says so.
   *
   * A `requires_explicit_unofficial_opt_in` status used to live here. Its only
   * production caller always supplied the opt-in, so the state was reachable
   * only by a test fabricating it — the same "guard whose only call sites are
   * tests" this file removed the overridable-coverage parameter for. Making
   * the parameter required is strictly stronger: the state cannot be expressed.
   */
  async queryFiscalizacion(
    query: BaseQuery,
    optIn: UnofficialOptIn,
    partyContext?: PartyMappingContext,
  ): Promise<OkResultsQueryResponse> {
    void optIn;
    const rows = await this.rowSource.fetchRows(query);
    const fiscalizacion = rows.filter((row) => row.sourceKind === "fiscalizacion");
    return {
      status: "ok",
      rows: await this.resolvePartyNames(fiscalizacion, partyContext),
      excluded: ResultsRepository.excludedByKind(rows, "fiscalizacion"),
    };
  }

  /**
   * Attaches `partyName` (task 15.14) — `null` for every row when no
   * `PartyNameSource`/`partyContext` was supplied (unchanged behaviour for
   * every existing caller), and `null` per-row when that row's `listId`
   * has no curated mapping entry (task 15.13: unmapped surfaces as `null`,
   * never as the bare `listId`).
   */
  private async resolvePartyNames(
    rows: ResultRow[],
    partyContext?: PartyMappingContext,
  ): Promise<ResultRow[]> {
    if (!this.partyNameSource || !partyContext) {
      // EXPLICIT `null` on both, as the field docs promise. Leaving
      // `canonicalPartyId` `undefined` made `compare` report "N rows resolved
      // to no canonical party" — a claim about the DATA — for what is really
      // a caller that configured no mapping source.
      return rows.map((row) => ({
        ...row,
        partyName: row.partyName ?? null,
        canonicalPartyId: row.canonicalPartyId ?? null,
      }));
    }

    const listIds = [...new Set(rows.map((row) => row.listId).filter((id): id is string => id !== null))];
    const names =
      listIds.length > 0
        ? await this.partyNameSource.fetchPartyNames(partyContext, listIds)
        : new Map<string, ResolvedParty>();

    return rows.map((row) => {
      const resolved = row.listId !== null ? (names.get(row.listId) ?? null) : null;
      return {
        ...row,
        partyName: resolved?.displayName ?? null,
        canonicalPartyId: resolved?.canonicalPartyId ?? null,
      };
    });
  }
}

/** Production `RowSource`: reads `result_row` through the RSC server client. */
export class SupabaseRowSource implements RowSource {
  constructor(private readonly client: SupabaseClient) {}

  async fetchRows(query: BaseQuery): Promise<ResultRow[]> {
    const { data, error } = await this.client
      .from("result_row")
      .select("jurisdiction_id, category_id, list_id, votes, source_kind, granularity, archive_entry_id")
      .eq("election_id", query.electionId)
      .eq("jurisdiction_id", query.jurisdictionId)
      .eq("category_id", query.categoryId);

    if (error) {
      throw new Error(`ResultsRepository: failed to read result_row: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      jurisdictionId: row["jurisdiction_id"] as string,
      categoryId: row["category_id"] as string,
      listId: row["list_id"] as string | null,
      votes: row["votes"] as number,
      sourceKind: row["source_kind"] as SourceKind,
      granularity: row["granularity"] as Granularity,
      archiveEntryId: row["archive_entry_id"] as string,
      // Resolved separately by `ResultsRepository.resolvePartyNames` —
      // never fabricated here.
      partyName: null,
    }));
  }
}

/**
 * Production `PartyNameSource`: reads `party_mapping` joined to
 * `party_canonical` for the exact curated key (task 15.14). A `list_id`
 * with no row in `party_mapping` for this `(year, jurisdiction, category)`
 * simply has no entry in the returned map — the caller (`ResultsRepository`)
 * is what turns that absence into the explicit `partyName: null` state.
 */
export class SupabasePartyNameSource implements PartyNameSource {
  constructor(private readonly client: SupabaseClient) {}

  async fetchPartyNames(
    context: PartyMappingContext,
    listIds: string[],
  ): Promise<Map<string, ResolvedParty>> {
    const names = new Map<string, ResolvedParty>();
    if (listIds.length === 0) return names;

    const { data, error } = await this.client
      .from("party_mapping")
      .select("list_id, canonical_party_id, party_canonical(display_name)")
      .eq("year", context.year)
      .eq("jurisdiction", context.jurisdiction)
      .eq("category", context.category)
      .in("list_id", listIds);

    if (error) {
      throw new Error(`SupabasePartyNameSource: failed to read party_mapping: ${error.message}`);
    }

    for (const row of data ?? []) {
      const listId = row["list_id"] as string;
      // Supabase's PostgREST client types a to-one nested relation as an
      // array at the type level even though it is a single row at
      // runtime (the join is on `canonical_party_id references
      // party_canonical(id)`, a many-to-one) -- narrow defensively rather
      // than assert a shape that does not match the generated type.
      const canonical = row["party_canonical"] as
        | { display_name: string }
        | { display_name: string }[]
        | null;
      const displayName = Array.isArray(canonical) ? canonical[0]?.display_name : canonical?.display_name;
      const canonicalPartyId = row["canonical_party_id"] as string | null;
      if (displayName && canonicalPartyId) {
        // The CANONICAL ID travels with the name. A display name is not an
        // identity: the curated file legitimately spells one canonical party
        // "LA LIBERTAD AVANZA" in 2023 and "ALIANZA LA LIBERTAD AVANZA" in
        // 2025, so keying a cross-year comparison on the name gives the two
        // sides zero common keys — the fabricated-flip defect one layer up
        // from the list ids it was moved off.
        names.set(listId, { canonicalPartyId, displayName });
      }
    }

    return names;
  }
}

export async function createResultsRepository(): Promise<ResultsRepository> {
  const client = await createSupabaseServerClient();
  return new ResultsRepository(new SupabaseRowSource(client), new SupabasePartyNameSource(client));
}

/**
 * Resolves `SourceRef`s for `ProvenanceLink` (provenance-display spec).
 * Thin DB wrapper, same as `SupabaseRowSource` — not fake-seamed for unit
 * tests, matching the existing convention for this project's direct
 * Supabase-client wrappers.
 */
export async function fetchSourceRefs(
  client: SupabaseClient,
  archiveEntryIds: string[],
): Promise<{ sources: SourceRef[]; missing: string[] }> {
  if (archiveEntryIds.length === 0) return { sources: [], missing: [] };

  const { data, error } = await client
    .from("archive_entry")
    .select("id, sha256, source_url, fetched_at")
    .in("id", archiveEntryIds);

  if (error) {
    throw new Error(`fetchSourceRefs: failed to read archive_entry: ${error.message}`);
  }

  const sources = (data ?? []).map((row) => ({
    archiveEntryId: row["id"] as string,
    // NO `?? ""`. This system is built on an immutable sha256 archive, so an
    // entry with no hash is an entry that cannot be verified — substituting an
    // empty string renders it through `ProvenanceLink` as provenance that
    // exists. `null` travels, and the display says "unhashed".
    sha256: row["sha256"] as string | null,
    url: row["source_url"] as string,
    fetchedAt: row["fetched_at"] as string,
  }));

  // Which requested ids came back with NOTHING. An id that resolves to no
  // `archive_entry` row -- RLS scope, a mid-write, a deleted entry -- used to
  // vanish, so `ProvenanceLink` rendered provenance for a SUBSET of the
  // figures on screen and said nothing about the rest.
  const found = new Set(sources.map((source) => source.archiveEntryId));
  return {
    sources,
    missing: archiveEntryIds.filter((id) => !found.has(id)),
  };
}
