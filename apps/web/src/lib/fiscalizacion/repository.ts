import type { SupabaseClient } from "@supabase/supabase-js";
import { mixedGranularityReason } from "@/lib/results/granularity";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import {
  GRANULARITY,
  type Coverage,
  type Granularity,
  type SourceKind,
  type SourceRef,
} from "@/lib/results/types";

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
  /**
   * Requested level, or null when historical request intent is unknown.
   * Optional only for manually constructed rows; the database boundary rejects a missing value.
   */
  requestedGranularity?: Granularity | null;
  /**
   * Mesa population declared by the source (`NATIVOS`, `EXTRANJEROS`, or
   * another non-empty source value). `null` means the persisted row is
   * explicitly untagged; optional only for manually constructed fixtures.
   */
  mesaTipo?: string | null;
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
    .map(([kind, tally]) => {
      const sourceLabel = kind === "official"
        ? "oficial"
        : kind === "fiscalizacion"
          ? "fiscalización"
          : kind === "unknown"
            ? "desconocida"
            : kind;
      return `${tally.rows} ${tally.rows === 1 ? "fila" : "filas"} ${sourceLabel} / ${tally.votes} ${tally.votes === 1 ? "voto" : "votos"}`;
    })
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
  // Keyed on the CANONICAL ID and labelled by the display name. Folding on the
  // name merged two canonical parties that happen to share a string and split
  // one party the curated file respells between years — the identity mistake
  // `topParty` refuses one file over.
  //
  // UNRESOLVED rows are not here at all. They have their own reported section
  // (`unmappedByListId`), and emitting `unmapped (list 4321): 700 votes` inside
  // the ranked party list put the same votes in two places, one of them where a
  // reader sums them as a party's figure.
  const displayNamesByCanonicalId = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.canonicalPartyId || !row.partyName) continue;
    const displayNames = displayNamesByCanonicalId.get(row.canonicalPartyId) ?? new Set<string>();
    displayNames.add(row.partyName);
    displayNamesByCanonicalId.set(row.canonicalPartyId, displayNames);
  }
  const conflicts = [...displayNamesByCanonicalId.entries()]
    .filter(([, displayNames]) => displayNames.size > 1)
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
  if (conflicts.length > 0) {
    const details = conflicts
      .map(
        ([canonicalPartyId, displayNames]) =>
          `${canonicalPartyId} -> ${[...displayNames].sort().join(", ")}`,
      )
      .join("; ");
    if (conflicts.length === 1) {
      const [canonicalPartyId, displayNames] = conflicts[0]!;
      throw new Error(
        `votesByParty: canonical party ${canonicalPartyId} has conflicting display names: ` +
          [...displayNames].sort().join(", "),
      );
    }
    throw new Error(`votesByParty: canonical parties have conflicting display names: ${details}`);
  }

  const totals = new Map<string, { votes: number; label: string }>();
  for (const row of rows) {
    if (!row.canonicalPartyId || !row.partyName) continue;
    const entry = totals.get(row.canonicalPartyId) ?? { votes: 0, label: row.partyName };
    totals.set(row.canonicalPartyId, { votes: entry.votes + row.votes, label: entry.label });
  }
  return [...totals.values()]
    .map(({ label, votes }) => ({ label, votes }))
    .sort((a, b) => b.votes - a.votes);
}

/**
 * Rows whose `listId` resolved to no curated party, per list id.
 *
 * `votesByParty` does not include them AT ALL — it used to label them
 * (`unmapped (list 110)`) inside the ranked list, which put the same votes in
 * two places. This is the only place they are reported, and a label alone
 * would not be a breakdown: one id covering 40 % of the votes and
 * forty ids covering 1 % each render identically. `fiscalizacion` reported
 * this per id; `drilldown` and `municipal` rendered the labels only.
 */
/**
 * Whether a row carries a usable party identity.
 *
 * ONE predicate. `compare` re-derived it inline, so a row was excluded from
 * every figure there while the disclosure depended on this fold agreeing by
 * coincidence — two definitions of "resolved" that a change to either would
 * separate, leaving rows in no tally on the page at all.
 */
export function isPartyResolved(
  row: ResultRow,
): row is ResultRow & { partyName: string; canonicalPartyId: string } {
  return (
    typeof row.partyName === "string" &&
    row.partyName.trim().length > 0 &&
    typeof row.canonicalPartyId === "string" &&
    row.canonicalPartyId.trim().length > 0
  );
}

export function unmappedByListId(rows: ResultRow[]): {
  entries: { listId: string; rows: number; votes: number }[];
  /**
   * Rows carrying NO list id at all, PER SOURCE KIND — not parties that failed
   * to map.
   *
   * One aggregate collapsed at least two distinct shapes (rule 2: legitimately
   * nullable historical rows, and current POSITIVO rows whose source identity
   * comes from `agrupacion_id`), and a large plausible total is how a destructive
   * filter survives review.
   */
  withoutListId: ExcludedByKind;
} {
  const totals = new Map<string, { rows: number; votes: number }>();
  const withoutListIdRows: ResultRow[] = [];
  for (const row of rows) {
    if (isPartyResolved(row)) continue;
    if (row.listId === null) {
      // NOT a list id that failed to map. Historical persisted rows may
      // legitimately carry null, while current source identity comes from
      // `agrupacion_id`; these are non-party rows. Bucketing them under
      // "resolved to no curated party" reports a shape the source never had.
      withoutListIdRows.push(row);
      continue;
    }
    const entry = totals.get(row.listId) ?? { rows: 0, votes: 0 };
    totals.set(row.listId, { rows: entry.rows + 1, votes: entry.votes + row.votes });
  }
  return {
    entries: [...totals.entries()]
      .map(([listId, tally]) => ({ listId, ...tally }))
      .sort((a, b) => b.votes - a.votes),
    withoutListId: tallyByKind(withoutListIdRows),
  };
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
  /**
   * The coverage the caller opted in with, TRAVELLING with the rows.
   *
   * `void optIn` made the opt-in a compile-time gate and nothing more: the
   * denominator survived only because the page happened to read the same
   * module constant, so a caller passing a different — or random-sample —
   * coverage produced a response indistinguishable from the correct one.
   * Undefined on the official path, which has no denominator to carry.
   */
  coverage?: Coverage;
  /**
   * Whether a curated mapping source was configured for THIS read.
   *
   * With none, every row comes back unresolved, and "resolved to no curated
   * party" would state a fact about the curated table that is really a fact
   * about the caller's configuration — the substitution `resolvePartyNames`
   * documents, one function downstream.
   */
  partyMappingConfigured: boolean;
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
  /**
   * Why THIS path's rows cannot be summed, or `null` when they can.
   *
   * Path 1's gate is computed from path 1's rows, and this file argues
   * everywhere that path 2 is an INDEPENDENT fetch whose row set can
   * legitimately differ — so a mixed set reaching only this path produced a
   * double-counted `totalVotes` that every surface rendered as the official
   * figure. A `seccion` row already contains the `mesa` rows beneath it.
   */
  unsummableReason: string | null;
  /**
   * The archive entries THIS read's rows came from.
   *
   * Path 2 fetches independently, so its rows can differ from path 1's — and
   * the page resolved provenance from path 1 only. `Official total` then
   * shipped as a displayed figure with no source record and could not even
   * appear in `missing`.
   */
  archiveEntryIds: string[];
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
    kept: ResultRow[],
  ): ExcludedByKind {
    // Derived from the KEPT collection, never from a second predicate over the
    // same rows. `rows.filter(r => r.sourceKind !== "official")` re-decided
    // what had been removed, so a widened keep-filter reported a row as
    // returned AND removed — a drop reported as a drop it was not. Path 2
    // already worked this way; paths 1 and 3 were the ones still guessing.
    // A Set, not `kept.includes`: still identity-based — which is the point,
    // the tally must describe the rows this call actually kept — but linear
    // rather than quadratic. `result_row` holds 18.17M rows.
    const keptRows = new Set(kept);
    return tallyByKind(rows.filter((row) => !keptRows.has(row)));
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
    const official = this.keep(rows, "official");
    return {
      status: "ok",
      rows: await this.resolvePartyNames(official, partyContext),
      partyMappingConfigured:
        this.partyNameSource !== undefined && partyContext !== undefined,
      excluded: ResultsRepository.excludedByKind(rows, official),
    };
  }

  /** Path 2 of the threat matrix: any aggregate built on top of a query. */
  /**
   * The rows this path will SUM. A `protected` seam, not an inline filter, so a
   * test can widen the filter itself rather than overwrite the tally it
   * produces — reading back an injected value proves nothing about the code.
   */
  protected officialRows(rows: ResultRow[]): ResultRow[] {
    return this.keep(rows, "official");
  }

  /**
   * THE keep-filter, for every path. Each query had its own inline
   * `rows.filter(...)`, so a test could only widen path 2 — and a subclass
   * claiming to widen "every path" silently exercised one of them twice.
   */
  protected keep(rows: ResultRow[], kind: SourceKind): ResultRow[] {
    return rows.filter((row) => row.sourceKind === kind);
  }

  async aggregateOfficialVotes(query: BaseQuery): Promise<AggregateVotes> {
    // ITS OWN fetch and ITS OWN filter. Delegating to `queryOfficial` made
    // this path a caller of path 1, so blocking one blocked all and unblocking
    // one unblocked all -- the opposite of the three independent guards D9.1
    // describes, and the reason its test passed while exercising path 1 twice.
    const rows = await this.rowSource.fetchRows(query);
    const summed = this.officialRows(rows);
    const totalVotes = summed.reduce((sum: number, row: ResultRow) => sum + row.votes, 0);
    return {
      totalVotes,
      sourceKind: "official",
      // Both halves from the SAME seam, via the shared helper.
      excluded: ResultsRepository.excludedByKind(rows, summed),
      // Judged on the rows THIS path summed, not on another read's.
      unsummableReason: mixedGranularityReason(summed),
      archiveEntryIds: [...new Set(summed.map((row) => row.archiveEntryId))].sort(),
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
    // The coverage is REQUIRED on the way back, not merely optional: this
    // method always sets it, so a caller narrowing `coverage` would be
    // guarding a state nothing can produce. `OkResultsQueryResponse` keeps it
    // optional because the official path has no denominator to carry.
  ): Promise<OkResultsQueryResponse & { coverage: Coverage }> {
    const rows = await this.rowSource.fetchRows(query);
    const fiscalizacion = this.keep(rows, "fiscalizacion");
    return {
      status: "ok",
      rows: await this.resolvePartyNames(fiscalizacion, partyContext),
      partyMappingConfigured:
        this.partyNameSource !== undefined && partyContext !== undefined,
      excluded: ResultsRepository.excludedByKind(rows, fiscalizacion),
      // Carried, not assumed: the figure and the denominator it must be read
      // against come back together.
      coverage: optIn.coverage,
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

const PAGINATION_ID_KIND = { UUID: "uuid", TEXT: "text" } as const;
type PaginationIdKind = (typeof PAGINATION_ID_KIND)[keyof typeof PAGINATION_ID_KIND];
const CANONICAL_UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

function requirePaginationId(value: unknown, context: string, kind: PaginationIdKind): string {
  const valid = typeof value === "string" && (kind === PAGINATION_ID_KIND.UUID
    ? CANONICAL_UUID.test(value) : value.trim().length > 0);
  if (valid) return value;
  const shape = value === null ? "null" : value === undefined ? "undefined"
    : typeof value !== "string" ? typeof value : value.length === 0 ? "empty string"
      : value.trim().length === 0 ? "blank string" : "non-canonical string";
  const required = kind === PAGINATION_ID_KIND.UUID ? "a canonical UUID string" : "non-blank text";
  throw new Error(`${context}.id pagination cursor must be ${required}; received ${shape}`);
}

/** Production `RowSource`: reads `result_row` through the RSC server client. */
export class SupabaseRowSource implements RowSource {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Reads EVERY matching row, in pages.
   *
   * A single unpaginated `select` is capped server-side by PostgREST
   * (`max-rows`, 1000 by default) and comes back TRUNCATED with no error and
   * no signal — so every figure downstream would be computed over a silent,
   * arbitrary subset while looking large and plausible. That is worse than a
   * quarantine: a quarantine at least reports, and this drop is one the code
   * never learns about. It would also defeat `drilldown`'s reconciliation
   * alert, since both independent reads truncate the same way and agree while
   * both are wrong.
   *
   * `result_row` holds 18.17M rows, so this is not a theoretical cap.
   */
  async fetchRows(query: BaseQuery): Promise<ResultRow[]> {
    const PAGE = 1000;
    const rows: ResultRow[] = [];
    let after: string | null = null;

    // KEYSET on the primary key, not an offset over a non-unique sort. Ordering
    // by `(list_id, archive_entry_id)` ties across every mesa — `result_row`
    // holds one row per (mesa, list) — and Postgres gives no ordering
    // guarantee inside a tie, so `range()` across a page boundary silently
    // repeats some rows and skips others. That is unbounded error with no
    // signal, which is worse than the truncation the loop was added to fix.
    // `id` is the uuid primary key, so it cannot tie.
    for (;;) {
      let request = this.client
        .from("result_row")
        .select(
          "id, jurisdiction_id, category_id, list_id, votes, source_kind, granularity, requested_granularity, mesa_tipo, archive_entry_id",
        )
        .eq("election_id", query.electionId)
        .eq("jurisdiction_id", query.jurisdictionId)
        .eq("category_id", query.categoryId)
        .order("id", { ascending: true })
        .limit(PAGE);
      if (after !== null) request = request.gt("id", after);

      const { data, error } = await request;
      if (error) {
        throw new Error(`ResultsRepository: failed to read result_row: ${error.message}`);
      }

      const page = data ?? [];
      // EMPTY, not "shorter than the page size I asked for". The server's
      // `max-rows` may be BELOW `PAGE`, and then the first response is short
      // for a reason that has nothing to do with exhaustion — the truncation
      // this loop exists to prevent, reintroduced by its own exit condition.
      if (page.length === 0) return rows;
      after = requirePaginationId(page[page.length - 1]?.["id"],
        "ResultsRepository: result_row", PAGINATION_ID_KIND.UUID);
      rows.push(...page.map((row) => toResultRow(row)));
    }
  }
}

/**
 * One row mapper, with the scalar shapes CHECKED rather than asserted.
 *
 * `row["votes"] as number` is a claim about a column type. PostgREST
 * serialises `int8`/`numeric` as a STRING, and `sum + row.votes` would then
 * concatenate — a total that is not a number and does not look wrong.
 * `fetchElectionYear` and `fetchCategoryName` already check with `typeof`;
 * this is the same discipline on the column every figure is built from.
 */
const GRANULARITY_VALUES = Object.values(GRANULARITY);
const GRANULARITY_ERROR_VALUES = GRANULARITY_VALUES.join(", ");

function isGranularity(value: unknown): value is Granularity {
  return typeof value === "string" && GRANULARITY_VALUES.includes(value as Granularity);
}

function parseVotes(value: unknown): number {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[0-9]+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (
    !Number.isSafeInteger(numericValue) ||
    numericValue < 0 ||
    numericValue > 2147483647
  ) {
    throw new Error(
      "ResultsRepository: result_row.votes must be a nonnegative 32-bit integer " +
        `(number or digits-only string); received ${JSON.stringify(value)}`,
    );
  }
  return numericValue;
}

function toResultRow(row: Record<string, unknown>): ResultRow {
  const numericVotes = parseVotes(row["votes"]);

  const archiveEntryId = row["archive_entry_id"];
  if (typeof archiveEntryId !== "string") {
    // A non-string here flows straight into `fetchSourceRefs` and comes back in
    // `missing`, mislabelling a bad column as absent provenance.
    throw new Error(
      `ResultsRepository: result_row.archive_entry_id is not a string (${JSON.stringify(archiveEntryId)})`,
    );
  }

  const sourceKind = row["source_kind"];
  if (typeof sourceKind !== "string") {
    // The column ALL THREE leakage guards key on. A NULL passes an `as` cast
    // and lands in the `unknown` bucket by luck of `tallyByKind`; saying so is
    // cheaper than relying on that.
    throw new Error(
      `ResultsRepository: result_row.source_kind is not a string (${JSON.stringify(sourceKind)}); ` +
        "every official/fiscalización guard reads this column",
    );
  }
  const granularity = row["granularity"];
  if (!isGranularity(granularity)) {
    throw new Error(
      `ResultsRepository: result_row.granularity must be one of ${GRANULARITY_ERROR_VALUES}; ` +
        `received ${JSON.stringify(granularity)}`,
    );
  }
  const requestedGranularity = row["requested_granularity"];
  const mesaTipo = row["mesa_tipo"];

  const jurisdictionId = row["jurisdiction_id"];
  const categoryId = row["category_id"];
  if (typeof jurisdictionId !== "string" || typeof categoryId !== "string") {
    // The identity columns every figure is grouped and filtered by. A NULL
    // here flows into `votesByParty` keys and jurisdiction totals with no
    // signal — the class the checked columns above were hardened against.
    throw new Error(
      "ResultsRepository: result_row.jurisdiction_id/category_id are not strings " +
        `(${JSON.stringify(jurisdictionId)}, ${JSON.stringify(categoryId)})`,
    );
  }

  const listId = row["list_id"];
  if (
    listId !== null &&
    (typeof listId !== "string" ||
      listId.length === 0 ||
      listId.trim() !== listId)
  ) {
    // The column the party mapping keys on. Missing, malformed, or normalized
    // identities miss on EVERY row and `resolvePartyNames` writes
    // `partyName: null` — the defined "no curated mapping" state. Every page
    // would then report the curated table as empty because of a bad column.
    throw new Error(
      "ResultsRepository: result_row.list_id must be null or a non-empty trimmed string " +
        `(${JSON.stringify(listId)}); the party mapping is keyed on it`,
    );
  }

  if (requestedGranularity !== null && !isGranularity(requestedGranularity)) {
    throw new Error(
      "ResultsRepository: result_row.requested_granularity must be null or one of " +
        `${GRANULARITY_ERROR_VALUES}; received ${JSON.stringify(requestedGranularity)}`,
    );
  }
  if (
    mesaTipo !== null &&
    (typeof mesaTipo !== "string" ||
      mesaTipo.length === 0 ||
      mesaTipo.trim() !== mesaTipo)
  ) {
    throw new Error(
      "ResultsRepository: result_row.mesa_tipo must be null or a non-empty trimmed string " +
        `(${JSON.stringify(mesaTipo)})`,
    );
  }

  return {
    jurisdictionId,
    categoryId,
    listId,
    votes: numericVotes,
    sourceKind: sourceKind as SourceKind,
    granularity,
    requestedGranularity,
    mesaTipo,
    archiveEntryId,
    // Resolved separately by `ResultsRepository.resolvePartyNames` —
    // never fabricated here.
    partyName: null,
  };
}

/**
 * Production `PartyNameSource`: reads `party_mapping` joined to
 * `party_canonical` for the exact curated key (task 15.14). A `list_id`
 * with no row in `party_mapping` for this `(year, jurisdiction, category)`
 * simply has no entry in the returned map — the caller (`ResultsRepository`)
 * is what turns that absence into the explicit `partyName: null` state.
 */
function parsePartyMappingId(
  value: unknown,
  column: "list_id" | "canonical_party_id",
  context: PartyMappingContext,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `SupabasePartyNameSource: party_mapping.${column} must be a non-empty string in ` +
        `(${context.year}, ${context.jurisdiction}, ${context.category}); received ` +
        JSON.stringify(value),
    );
  }
  return value;
}

function parseCanonicalDisplayName(
  canonical: unknown,
  listId: string,
  context: PartyMappingContext,
): string {
  const relation = Array.isArray(canonical)
    ? canonical.length === 1
      ? canonical[0]
      : null
    : canonical;
  if (
    typeof relation !== "object" ||
    relation === null ||
    !("display_name" in relation) ||
    typeof relation.display_name !== "string" ||
    relation.display_name.length === 0
  ) {
    throw new Error(
      `SupabasePartyNameSource: list id ${listId} has malformed party_canonical relation in ` +
        `(${context.year}, ${context.jurisdiction}, ${context.category}); expected an object or ` +
        "exactly one-element array with a non-empty string display_name",
    );
  }
  return relation.display_name;
}

export class SupabasePartyNameSource implements PartyNameSource {
  constructor(private readonly client: SupabaseClient) {}

  async fetchPartyNames(
    context: PartyMappingContext,
    listIds: string[],
  ): Promise<Map<string, ResolvedParty>> {
    const names = new Map<string, ResolvedParty>();
    if (listIds.length === 0) return names;

    // BATCHED, and every batch read to exhaustion. A single `.in(...)` is
    // capped server-side like any other select, and a truncated read here is
    // worse than a lost row: `resolvePartyNames` writes `partyName: null`,
    // which is the DEFINED "no curated mapping" state, so the page reports a
    // claim about the CURATED DATA that is really a claim about a short read.
    // The id list also travels in a GET URL, which has its own length limit.
    // BATCHED at 200, and the batch is verified READ WHOLE below. A truncated
    // read here would be worse than a lost row: `resolvePartyNames` writes
    // `partyName: null`, which is the DEFINED "no curated mapping" state, so
    // the page would state a fact about the curated data that is really a fact
    // about a short read.
    //
    // Offset paging over `list_id` is not an option — nothing proves that
    // column unique inside the key, and that is the repeat-and-skip defect
    // `SupabaseRowSource` rejects in writing.
    // BATCHED at 200, and each batch PAGED TO EXHAUSTION on the primary key —
    // the same discipline `SupabaseRowSource` uses, for the same reason. A row
    // count cannot detect truncation here: `byListId.size < batch.length` is
    // also what a legitimately unmapped id looks like, so a short read and "no
    // curated mapping" are indistinguishable from the outside. The only honest
    // fix is to read until the server has nothing left to give.
    //
    // A truncated read would be worse than a lost row: `resolvePartyNames`
    // writes `partyName: null`, the DEFINED "no curated mapping" state, and the
    // page then states a fact about the curated data that is really a fact
    // about a short read.
    //
    // Keyset on `id` (uuid, unique): ordering by `list_id` is the
    // repeat-and-skip defect `SupabaseRowSource` rejects, since nothing proves
    // that column unique inside the key.
    const BATCH = 200;
    const PAGE = 1000;
    const rows: Record<string, unknown>[] = [];

    for (let start = 0; start < listIds.length; start += BATCH) {
      const batch = listIds.slice(start, start + BATCH);
      let after: string | null = null;

      for (;;) {
        let request = this.client
          .from("party_mapping")
          .select("id, list_id, canonical_party_id, party_canonical(display_name)")
          .eq("year", context.year)
          .eq("jurisdiction", context.jurisdiction)
          .eq("category", context.category)
          .in("list_id", batch)
          .order("id", { ascending: true })
          .limit(PAGE);
        if (after !== null) request = request.gt("id", after);

        const { data, error } = await request;
        if (error) {
          throw new Error(`SupabasePartyNameSource: failed to read party_mapping: ${error.message}`);
        }

        const page = (data ?? []) as unknown as Record<string, unknown>[];
        // EMPTY, never "shorter than I asked for": the server cap may be below
        // `PAGE`, and then a short first page means nothing about exhaustion.
        if (page.length === 0) break;
        after = requirePaginationId(page[page.length - 1]?.["id"],
          "SupabasePartyNameSource: party_mapping", PAGINATION_ID_KIND.UUID);
        rows.push(...page);
      }
    }

    // Ambiguity, PER LIST ID and over the whole read. Two canonical parties for
    // one id is an identity nobody can choose between, not a row to pick.
    const byListId = new Map<string, Set<string>>();
    for (const row of rows) {
      const listId = parsePartyMappingId(row["list_id"], "list_id", context);
      const canonicalPartyId = parsePartyMappingId(
        row["canonical_party_id"],
        "canonical_party_id",
        context,
      );
      const seen = byListId.get(listId) ?? new Set<string>();
      seen.add(canonicalPartyId);
      byListId.set(listId, seen);
    }
    const ambiguous = [...byListId.entries()].filter(([, ids]) => ids.size > 1);
    if (ambiguous.length > 0) {
      throw new Error(
        `SupabasePartyNameSource: in (${context.year}, ${context.jurisdiction}, ` +
          `${context.category}) these list ids map to more than one canonical ` +
          `party, so no name can be chosen for them: ` +
          ambiguous.map(([listId, ids]) => `${listId} -> ${[...ids].sort().join(", ")}`).join("; "),
      );
    }

    // A canonical id has ONE display name inside this exact mapping scope.
    // Choosing whichever mapping row arrived first would make the displayed
    // party depend on database and pagination order.
    const displayNamesByCanonicalId = new Map<string, Set<string>>();
    for (const row of rows) {
      const canonicalPartyId = parsePartyMappingId(
        row["canonical_party_id"],
        "canonical_party_id",
        context,
      );
      const listId = parsePartyMappingId(row["list_id"], "list_id", context);
      const displayName = parseCanonicalDisplayName(row["party_canonical"], listId, context);
      const seen = displayNamesByCanonicalId.get(canonicalPartyId) ?? new Set<string>();
      seen.add(displayName);
      displayNamesByCanonicalId.set(canonicalPartyId, seen);
    }
    const conflictingDisplayNames = [...displayNamesByCanonicalId.entries()]
      .filter(([, displayNames]) => displayNames.size > 1)
      .sort(([left], [right]) => left.localeCompare(right));
    if (conflictingDisplayNames.length > 0) {
      throw new Error(
        `SupabasePartyNameSource: in (${context.year}, ${context.jurisdiction}, ` +
          `${context.category}) these canonical parties have conflicting display names, ` +
          `so no name can be chosen for them: ` +
          conflictingDisplayNames
            .map(
              ([canonicalPartyId, displayNames]) =>
                `${canonicalPartyId} -> ${[...displayNames].sort().join(", ")}`,
            )
            .join("; "),
      );
    }

    for (const row of rows) {
      const listId = parsePartyMappingId(row["list_id"], "list_id", context);
      // ONE parser owns both validation passes. Supabase may return a to-one
      // relation as an object or a one-element array, but no other shape can be
      // interpreted without silently choosing or dropping a relation row.
      const displayName = parseCanonicalDisplayName(
        row["party_canonical"],
        listId,
        context,
      );
      const canonicalPartyId = parsePartyMappingId(
        row["canonical_party_id"],
        "canonical_party_id",
        context,
      );
      // The CANONICAL ID travels with the name. A display name is not an
      // identity: the curated file legitimately spells one canonical party
      // "LA LIBERTAD AVANZA" in 2023 and "ALIANZA LA LIBERTAD AVANZA" in
      // 2025, so keying a cross-year comparison on the name gives the two
      // sides zero common keys — the fabricated-flip defect one layer up
      // from the list ids it was moved off.
      names.set(listId, { canonicalPartyId, displayName });
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
/**
 * The year an election was held, from the `election` table.
 *
 * THE source for this fact. Four routes derived it by parsing the election id
 * string, which works for a curated slug like `2025-legislativas-nacional` and
 * never for what the database actually stores: `election.id` is a uuid and
 * `election.year` is a column beside it. So every real request refused with
 * "provide an election id that carries its year" — the id was fine, the reader
 * was looking in the wrong place.
 *
 * `null` when no election row carries that id, which is a REFUSAL and not a
 * year: resolving list ids through a mapping year nobody established is the
 * "one party, three ids" failure the party context exists to prevent.
 */
export type YearLookup =
  | { status: "ok"; year: number }
  | { status: "no_row" }
  | { status: "unreadable_year" };

export async function fetchElectionYear(
  client: SupabaseClient,
  electionId: string,
): Promise<YearLookup> {
  const { data, error } = await client
    .from("election")
    .select("year")
    .eq("id", electionId)
    .maybeSingle();

  if (error) {
    throw new Error(`fetchElectionYear: failed to read election: ${error.message}`);
  }

  // THREE answers, not two. `null` meant either "no election row carries this
  // id" or "the row exists and its year is unusable", and three pages stated
  // the first as a fact about the database — the same shape as saying "no
  // official results found" about a refused read.
  if (!data) return { status: "no_row" };
  const year = data["year"];
  return typeof year === "number" ? { status: "ok", year } : { status: "unreadable_year" };
}

/**
 * The curated label of a category, from the `category` table.
 *
 * Two free-text params described one fact: `categoryId` filters `result_row`
 * and `partyCategory` keys `party_mapping`, and nothing tied them. The
 * jurisdiction axis is bounded by `resolvePartyFamily` and the year axis by
 * `fetchElectionYear`; this axis was bounded by nothing, so diputado rows
 * resolved through the senador mapping named a different canonical party for
 * any list id present in both tables — and `compare` rendered that as a flip
 * for a party that never changed hands.
 *
 * `null` when no category row carries that id, which is a refusal.
 */
export type CategoryLookup =
  | { status: "ok"; name: string }
  | { status: "no_row" }
  | { status: "unreadable_name" };

export async function fetchCategoryName(
  client: SupabaseClient,
  categoryId: string,
): Promise<CategoryLookup> {
  const { data, error } = await client
    .from("category")
    .select("name")
    .eq("id", categoryId)
    .maybeSingle();

  if (error) {
    throw new Error(`fetchCategoryName: failed to read category: ${error.message}`);
  }

  if (!data) return { status: "no_row" };
  const name = data["name"];
  return typeof name === "string" ? { status: "ok", name } : { status: "unreadable_name" };
}

function parseSha256(value: unknown, archiveEntryId: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(
      `fetchSourceRefs: archive_entry.sha256 must be null or lowercase 64-character hex for ` +
        `${archiveEntryId}; received ${JSON.stringify(value)}`,
    );
  }
  return value;
}

export async function fetchSourceRefs(
  client: SupabaseClient,
  archiveEntryIds: string[],
): Promise<{ sources: SourceRef[]; missing: string[] }> {
  if (archiveEntryIds.length === 0) return { sources: [], missing: [] };

  // BATCHED and PAGED, like every other read in this file. A single `.in()` is
  // capped server-side, and a truncated response here does not lose a row
  // quietly — it lands in `missing`, which the pages render as "this figure
  // cannot be traced". That is a claim about the ARCHIVE, produced by a short
  // read: the same substitution the party-mapping read was fixed for.
  const BATCH = 200;
  const PAGE = 1000;
  const data: { row: Record<string, unknown>; archiveEntryId: string }[] = [];

  for (let start = 0; start < archiveEntryIds.length; start += BATCH) {
    const batch = archiveEntryIds.slice(start, start + BATCH);
    let after: string | null = null;

    for (;;) {
      let request = client
        .from("archive_entry")
        .select("id, sha256, source_url, fetched_at")
        .in("id", batch)
        .order("id", { ascending: true })
        .limit(PAGE);
      if (after !== null) request = request.gt("id", after);

      const { data: page, error } = await request;
      if (error) {
        throw new Error(`fetchSourceRefs: failed to read archive_entry: ${error.message}`);
      }

      const rows = (page ?? []) as unknown as Record<string, unknown>[];
      if (rows.length === 0) break;
      const parsed = rows.map((row) => ({ row, archiveEntryId: requirePaginationId(
        row["id"], "fetchSourceRefs: archive_entry", PAGINATION_ID_KIND.TEXT,
      ) }));
      data.push(...parsed);
      after = parsed[parsed.length - 1]!.archiveEntryId;
    }
  }

  const sources = data.map(({ row, archiveEntryId }) => {
    const url = row["source_url"];
    const fetchedAt = row["fetched_at"];
    const sha256 = parseSha256(row["sha256"], archiveEntryId);
    if (typeof url !== "string" || typeof fetchedAt !== "string") {
      // A NULL `source_url` would produce a `SourceRef` present in `sources`
      // and absent from `missing`, so the figure renders as TRACED with
      // nothing behind it. That is unverifiable shown as verified — worse than
      // the blank digest the `sha256: string | null` comment already rejects.
      throw new Error(
        `fetchSourceRefs: archive_entry ${archiveEntryId} has no usable source_url/fetched_at ` +
          `(${JSON.stringify(url)}, ${JSON.stringify(fetchedAt)}), so a figure citing it cannot ` +
          "be shown as traced",
      );
    }
    return {
      archiveEntryId,
      // NO `?? ""`. This system is built on an immutable sha256 archive, so an
      // entry with no hash is an entry that cannot be verified — substituting
      // an empty string renders it through `ProvenanceLink` as provenance that
      // exists. `null` travels, and the display says "unhashed".
      sha256,
      url,
      fetchedAt,
    };
  });

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
