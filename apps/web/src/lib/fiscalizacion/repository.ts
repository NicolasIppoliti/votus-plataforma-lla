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

export interface PartyNameSource {
  fetchPartyNames(context: PartyMappingContext, listIds: string[]): Promise<Map<string, string>>;
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

export type ResultsQueryResponse =
  | { status: "ok"; rows: ResultRow[] }
  | { status: "requires_explicit_unofficial_opt_in"; reason: string };

export interface AggregateVotes {
  totalVotes: number;
  sourceKind: "official";
}

export class ResultsRepository {
  constructor(
    private readonly rowSource: RowSource,
    private readonly partyNameSource?: PartyNameSource,
  ) {}

  /** Path 1 of the threat matrix: the default query. */
  async queryOfficial(
    query: BaseQuery,
    partyContext?: PartyMappingContext,
  ): Promise<ResultsQueryResponse> {
    const rows = await this.rowSource.fetchRows(query);
    const official = rows.filter((row) => row.sourceKind === "official");
    return { status: "ok", rows: await this.resolvePartyNames(official, partyContext) };
  }

  /** Path 2 of the threat matrix: any aggregate built on top of a query. */
  async aggregateOfficialVotes(query: BaseQuery): Promise<AggregateVotes> {
    // `queryOfficial` always resolves `status: "ok"` — it never refuses —
    // so this narrows a structurally wider `ResultsQueryResponse` down to
    // the branch that actually carries `rows`.
    const response = await this.queryOfficial(query);
    const rows = response.status === "ok" ? response.rows : [];
    const totalVotes = rows.reduce((sum: number, row: ResultRow) => sum + row.votes, 0);
    return { totalVotes, sourceKind: "official" };
  }

  /**
   * The only path that can return fiscalización rows. Refuses outright
   * (D9.2, `requires_explicit_unofficial_opt_in`) without a `Coverage`
   * value — every fiscalización aggregate MUST carry its coverage
   * denominator, and `Coverage.isRandomSample` is the literal `false`.
   */
  async queryFiscalizacion(
    query: BaseQuery,
    optIn?: UnofficialOptIn,
    partyContext?: PartyMappingContext,
  ): Promise<ResultsQueryResponse> {
    if (!optIn) {
      return {
        status: "requires_explicit_unofficial_opt_in",
        reason:
          "fiscalización is party-internal, unofficial, and partial coverage " +
          "(93/153 mesas — not a random sample); an explicit opt-in carrying " +
          "the Coverage figure is required before any fiscalización row is returned",
      };
    }

    const rows = await this.rowSource.fetchRows(query);
    const fiscalizacion = rows.filter((row) => row.sourceKind === "fiscalizacion");
    return { status: "ok", rows: await this.resolvePartyNames(fiscalizacion, partyContext) };
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
      return rows.map((row) => ({ ...row, partyName: row.partyName ?? null }));
    }

    const listIds = [...new Set(rows.map((row) => row.listId).filter((id): id is string => id !== null))];
    const names =
      listIds.length > 0
        ? await this.partyNameSource.fetchPartyNames(partyContext, listIds)
        : new Map<string, string>();

    return rows.map((row) => ({
      ...row,
      partyName: row.listId !== null ? (names.get(row.listId) ?? null) : null,
    }));
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
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (listIds.length === 0) return names;

    const { data, error } = await this.client
      .from("party_mapping")
      .select("list_id, party_canonical(display_name)")
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
      if (displayName) {
        names.set(listId, displayName);
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
): Promise<SourceRef[]> {
  if (archiveEntryIds.length === 0) return [];

  const { data, error } = await client
    .from("archive_entry")
    .select("id, sha256, source_url, fetched_at")
    .in("id", archiveEntryIds);

  if (error) {
    throw new Error(`fetchSourceRefs: failed to read archive_entry: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    archiveEntryId: row["id"] as string,
    sha256: (row["sha256"] as string | null) ?? "",
    url: row["source_url"] as string,
    fetchedAt: row["fetched_at"] as string,
  }));
}
