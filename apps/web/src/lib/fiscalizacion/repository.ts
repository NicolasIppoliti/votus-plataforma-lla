import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import type { Coverage, Granularity, SourceKind } from "@/lib/results/types";

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
  constructor(private readonly rowSource: RowSource) {}

  /** Path 1 of the threat matrix: the default query. */
  async queryOfficial(query: BaseQuery): Promise<ResultsQueryResponse> {
    const rows = await this.rowSource.fetchRows(query);
    return { status: "ok", rows: rows.filter((row) => row.sourceKind === "official") };
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
    return { status: "ok", rows: rows.filter((row) => row.sourceKind === "fiscalizacion") };
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
    }));
  }
}

export async function createResultsRepository(): Promise<ResultsRepository> {
  const client = await createSupabaseServerClient();
  return new ResultsRepository(new SupabaseRowSource(client));
}
