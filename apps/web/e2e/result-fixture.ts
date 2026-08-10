import { createClient } from "@supabase/supabase-js";
import { assertE2eEnvironment } from "./gate-contract";
import { planResultCleanup, planResultNaturalKeys, resultScenarioIdentity,
  type DataScenarioSpec } from "./scenario-ownership";
type SeedRow = Record<string, string | number | null>;
export interface ResultFixtureSeed { category: SeedRow; jurisdiction: SeedRow;
  elections: SeedRow[]; rows: SeedRow[]; }
interface SupabaseOperation { error: { message: string } | null; }
const environment = assertE2eEnvironment(process.env);
export const OFFICIAL_VOTES = 11_111;
export const FISCALIZACION_VOTES = 22_222;
export function sourceIsolationFixture(spec: DataScenarioSpec) {
  const identity = resultScenarioIdentity(spec);
  if (identity.electionIds.length !== 1 || identity.archiveEntryIds.length !== 2)
    throw new Error(`source-isolation scenario has invalid identity cardinality: ${spec}`);
  const scope = { electionId: identity.electionIds[0]!, jurisdictionId: identity.jurisdictionId,
    categoryId: identity.categoryId };
  const seed: ResultFixtureSeed = {
    category: { id: scope.categoryId, name: identity.categoryName },
    jurisdiction: { id: scope.jurisdictionId, distrito_code: identity.distritoCode,
      seccion_code: identity.seccionCode },
    elections: [{ id: scope.electionId, year: identity.electionYears[0]!,
      round: identity.electionRounds[0]! }],
    rows: [
    {
      election_id: scope.electionId, jurisdiction_id: scope.jurisdictionId,
      category_id: scope.categoryId, granularity: "seccion", list_id: null,
      votes: OFFICIAL_VOTES, source_kind: "official", source_row_index: 0,
      archive_entry_id: identity.archiveEntryIds[0]!,
    },
    {
      election_id: scope.electionId, jurisdiction_id: scope.jurisdictionId,
      category_id: scope.categoryId, granularity: "seccion", list_id: null,
      votes: FISCALIZACION_VOTES, source_kind: "fiscalizacion", source_row_index: 1,
      archive_entry_id: identity.archiveEntryIds[1]!,
    },
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
    `category:${seed.category["id"]}`, `jurisdiction:${seed.jurisdiction["id"]}`,
    ...exactStrings(seed.elections, "id").map((id) => `election:${id}`),
    ...archiveEntryIds.map((id) => `result_row:${id}`),
  ].sort();
  const actualNaturalKeys = [
    `category:${seed.category["name"]}`,
    `jurisdiction:${seed.jurisdiction["distrito_code"]}|${seed.jurisdiction["seccion_code"]}|${seed.jurisdiction["circuito_code"] ?? "null"}|${seed.jurisdiction["establecimiento_code"] ?? "null"}|${seed.jurisdiction["mesa_code"] ?? "null"}`,
    ...seed.elections.map((row) => `election:${row["year"]}|${row["round"]}`),
    ...seed.rows.map((row) =>
      `result:${row["archive_entry_id"]}|${row["jurisdiction_id"]}|${row["category_id"]}|${row["list_id"] ?? "null"}|${row["source_kind"]}`),
  ].sort();
  if (JSON.stringify(actualCleanup) !== JSON.stringify(planResultCleanup(spec).sort()) ||
      JSON.stringify(actualNaturalKeys) !== JSON.stringify(planResultNaturalKeys(spec).sort()) ||
      seed.rows.some((row) => row["jurisdiction_id"] !== identity.jurisdictionId ||
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
    for (const [table, value] of [["category", seed.category], ["jurisdiction", seed.jurisdiction],
      ["election", seed.elections], ["result_row", seed.rows]] as const)
      assertOperation(await admin.from(table).insert(value), `failed to seed ${table}`);
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
  await cleanup("jurisdiction", admin.from("jurisdiction").delete().eq("id", seed.jurisdiction["id"]));
  await cleanup("category", admin.from("category").delete().eq("id", seed.category["id"]));
  if ("error" in outcome) {
    if (cleanupErrors.length > 0)
      throw new AggregateError([outcome.error, ...cleanupErrors], "fixture and cleanup failed");
    throw outcome.error;
  }
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "fixture cleanup failed");
  return outcome.value;
}
