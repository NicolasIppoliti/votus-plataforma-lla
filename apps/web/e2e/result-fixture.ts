import { createClient } from "@supabase/supabase-js";
import { assertE2eEnvironment } from "./gate-contract";
import { planResultCleanup, planResultNaturalKeys, resultNaturalKey, resultScenarioIdentity,
  type DataScenarioSpec } from "./scenario-ownership";
type SeedRow = Record<string, string | number | null>;
export interface ResultFixtureSeed { category: SeedRow; jurisdictions: SeedRow[];
  elections: SeedRow[]; archiveEntries?: SeedRow[]; rows: SeedRow[]; }
interface SupabaseOperation { error: { message: string } | null; }
const environment = assertE2eEnvironment(process.env);
export const OFFICIAL_VOTES = 11_111;
export const FISCALIZACION_VOTES = 22_222;
function archiveEntries(ids: readonly string[], fiscalizacionIndex: number): SeedRow[] {
  return ids.map((id, index) => ({ id,
    capability: index === fiscalizacionIndex ? "fiscalizacion" : "national",
    source: "example.test", source_url: `https://example.test/${id}`,
    sha256: String(index + 1).repeat(64), mime: "text/csv",
    fetched_at: "2026-08-10T00:00:00Z", status: "ok",
    source_kind: index === fiscalizacionIndex ? "fiscalizacion" : "official" }));
}
export function sourceIsolationFixture(spec: DataScenarioSpec) {
  const identity = resultScenarioIdentity(spec);
  if (identity.electionIds.length !== 1 || identity.archiveEntryIds.length !== 2)
    throw new Error(`source-isolation scenario has invalid identity cardinality: ${spec}`);
  const scope = { electionId: identity.electionIds[0]!, jurisdictionId: identity.jurisdictionId,
    categoryId: identity.categoryId };
  const seed: ResultFixtureSeed = {
    category: { id: scope.categoryId, name: identity.categoryName },
    jurisdictions: [{ id: scope.jurisdictionId, distrito_code: identity.distritoCode,
      seccion_code: identity.seccionCode,
      ...(identity.scenario === "provenance" ? { circuito_code: "00001",
        establecimiento_code: "E1", establecimiento_name: "Synthetic school", mesa_code: 1 } : {}) }],
    elections: [{ id: scope.electionId, year: identity.electionYears[0]!,
      round: identity.electionRounds[0]! }],
    ...(identity.scenario === "provenance"
      ? { archiveEntries: archiveEntries(identity.archiveEntryIds, 1) } : {}),
    rows: [
    {
      election_id: scope.electionId, jurisdiction_id: scope.jurisdictionId,
       category_id: scope.categoryId, granularity: identity.scenario === "provenance" ? "mesa" : "seccion", list_id: null,
      votes: OFFICIAL_VOTES, source_kind: "official", source_row_index: 0,
      archive_entry_id: identity.archiveEntryIds[0]!,
    },
    {
      election_id: scope.electionId, jurisdiction_id: scope.jurisdictionId,
       category_id: scope.categoryId, granularity: identity.scenario === "provenance" ? "mesa" : "seccion", list_id: null,
      votes: FISCALIZACION_VOTES, source_kind: "fiscalizacion", source_row_index: 1,
      archive_entry_id: identity.archiveEntryIds[1]!,
    },
    ],
  };
  return { scope, seed };
}
export function coverageFixture(spec: DataScenarioSpec) {
  const identity = resultScenarioIdentity(spec);
  if (identity.scenario !== "fiscalizacion" || identity.jurisdictionIds.length !== 2 ||
      identity.archiveEntryIds.length !== 3) throw new Error("coverage scenario identity is incomplete");
  const [coveredId, uncoveredId] = identity.jurisdictionIds;
  const [officialCovered, fiscalizacion, officialUncovered] = identity.archiveEntryIds;
  const scope = { electionId: identity.electionIds[0]!, categoryId: identity.categoryId,
    distritoCode: identity.distritoCode, seccionCode: identity.seccionCode };
  const ownedArchiveEntries = archiveEntries(identity.archiveEntryIds, 1);
  const seed: ResultFixtureSeed = {
    category: { id: identity.categoryId, name: identity.categoryName },
    jurisdictions: [
      { id: coveredId!, distrito_code: identity.distritoCode, seccion_code: identity.seccionCode,
        circuito_code: "00001", establecimiento_code: "E1", establecimiento_name: "Synthetic school",
        mesa_code: 1 },
      { id: uncoveredId!, distrito_code: identity.distritoCode, seccion_code: identity.seccionCode,
        circuito_code: "00002", establecimiento_code: "E1", establecimiento_name: "Synthetic school",
        mesa_code: 2 },
    ],
    elections: [{ id: scope.electionId, year: identity.electionYears[0]!,
      round: identity.electionRounds[0]! }],
    archiveEntries: ownedArchiveEntries,
    rows: [
      { election_id: scope.electionId, jurisdiction_id: coveredId!, category_id: identity.categoryId,
        granularity: "mesa", list_id: null, votes: OFFICIAL_VOTES, source_kind: "official",
        source_row_index: 0, archive_entry_id: officialCovered! },
      { election_id: scope.electionId, jurisdiction_id: coveredId!, category_id: identity.categoryId,
        granularity: "mesa", list_id: null, votes: FISCALIZACION_VOTES, source_kind: "fiscalizacion",
        source_row_index: 1, archive_entry_id: fiscalizacion! },
      { election_id: scope.electionId, jurisdiction_id: uncoveredId!, category_id: identity.categoryId,
        granularity: "mesa", list_id: null, votes: 33_333, source_kind: "official",
        source_row_index: 2, archive_entry_id: officialUncovered! },
    ],
  };
  return { scope, seed };
}
function assertOperation(operation: SupabaseOperation, label: string): void {
  if (operation.error) throw new Error(`${label}: ${operation.error.message}`);
}
function exactStrings(rows: SeedRow[], key: string): string[] {
  return rows.map((row) => row[key]).filter((value): value is string => typeof value === "string").sort();
}
function assertSeedOwnership(spec: DataScenarioSpec, seed: ResultFixtureSeed): string[] {
  const identity = resultScenarioIdentity(spec);
  const archiveEntryIds = exactStrings(seed.rows, "archive_entry_id");
  const actualCleanup = [
    `category:${seed.category["id"]}`,
    ...seed.jurisdictions.map((row) => `jurisdiction:${row["id"]}`),
    ...exactStrings(seed.elections, "id").map((id) => `election:${id}`),
    ...exactStrings(seed.archiveEntries ?? [], "id").map((id) => `archive_entry:${id}`),
    ...archiveEntryIds.map((id) => `result_row:${id}`),
  ].sort();
  const actualNaturalKeys = [
    `category:${seed.category["name"]}`,
    ...seed.jurisdictions.map((row) =>
      `jurisdiction:${row["distrito_code"]}|${row["seccion_code"]}|${row["circuito_code"] ?? "null"}|${row["establecimiento_code"] ?? "null"}|${row["mesa_code"] ?? "null"}`),
    ...seed.elections.map((row) => `election:${row["year"]}|${row["round"]}`),
    ...seed.rows.map((row) => resultNaturalKey({
      archiveEntryId: String(row["archive_entry_id"]), electionId: String(row["election_id"]),
      jurisdictionId: String(row["jurisdiction_id"]), categoryId: String(row["category_id"]),
      listId: typeof row["list_id"] === "string" ? row["list_id"] : null,
      sourceKind: String(row["source_kind"]),
    })),
  ].sort();
  if (JSON.stringify(actualCleanup) !== JSON.stringify(planResultCleanup(spec).sort()) ||
      JSON.stringify(actualNaturalKeys) !== JSON.stringify(planResultNaturalKeys(spec).sort()) ||
      seed.rows.some((row) => !identity.jurisdictionIds.includes(String(row["jurisdiction_id"])) ||
        row["category_id"] !== identity.categoryId ||
        !identity.electionIds.includes(String(row["election_id"]))))
    throw new Error(`fixture seed does not exactly match owned identity: ${spec}`);
  if (new Set(archiveEntryIds).size !== seed.rows.length)
    throw new Error(`fixture seed contains duplicate or missing result identity: ${spec}`);
  return archiveEntryIds;
}
export async function withResultFixture<T>(spec: DataScenarioSpec, seed: ResultFixtureSeed,
  run: () => Promise<T>): Promise<T> {
  const archiveEntryIds = assertSeedOwnership(spec, seed);
  const admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY);
  let outcome: { value: T } | { error: unknown };
  try {
    for (const [table, value] of [["category", seed.category], ["jurisdiction", seed.jurisdictions],
      ["election", seed.elections]] as const)
      assertOperation(await admin.from(table).insert(value), `failed to seed ${table}`);
    if (seed.archiveEntries && seed.archiveEntries.length > 0)
      assertOperation(await admin.from("archive_entry").insert(seed.archiveEntries),
        "failed to seed archive entries");
    assertOperation(await admin.from("result_row").insert(seed.rows), "failed to seed result rows");
    outcome = { value: await run() };
  } catch (error) { outcome = { error }; }
  const cleanupErrors: unknown[] = [];
  const cleanup = async (label: string, operation: PromiseLike<SupabaseOperation>) => {
    try { const result = await operation;
      if (result.error) cleanupErrors.push(new Error(`${label}: ${result.error.message}`));
    } catch (error) { cleanupErrors.push(error); }
  };
  await cleanup("result rows", admin.from("result_row").delete().in("archive_entry_id", archiveEntryIds));
  await cleanup("elections", admin.from("election").delete().in("id", seed.elections.map(({ id }) => id)));
  if (seed.archiveEntries && seed.archiveEntries.length > 0)
    await cleanup("archive entries", admin.from("archive_entry").delete().in("id", seed.archiveEntries.map(({ id }) => id)));
  await cleanup("jurisdiction", admin.from("jurisdiction").delete().in("id", seed.jurisdictions.map(({ id }) => id)));
  await cleanup("category", admin.from("category").delete().eq("id", seed.category["id"]));
  if ("error" in outcome) {
    if (cleanupErrors.length > 0)
      throw new AggregateError([outcome.error, ...cleanupErrors], "fixture and cleanup failed");
    throw outcome.error;
  }
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "fixture cleanup failed");
  return outcome.value;
}
