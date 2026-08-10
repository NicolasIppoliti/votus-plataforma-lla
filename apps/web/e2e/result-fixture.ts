import { createClient } from "@supabase/supabase-js";
import { assertE2eEnvironment } from "./gate-contract";
type SeedRow = Record<string, string | number | null>;
export interface ResultFixtureSeed { category: SeedRow; jurisdiction: SeedRow;
  elections: SeedRow[]; rows: SeedRow[]; archivePrefix: string; }
interface SupabaseOperation { error: { message: string } | null; }
const environment = assertE2eEnvironment(process.env);
export const OFFICIAL_VOTES = 11_111;
export const FISCALIZACION_VOTES = 22_222;
export const SOURCE_SCOPE = { electionId: environment.FISCALIZACION_ELECTION_ID,
  jurisdictionId: environment.NATIONAL_JURISDICTION_ID,
  categoryId: environment.FISCALIZACION_CATEGORY_ID } as const;
export const SOURCE_ISOLATION_FIXTURE: ResultFixtureSeed = {
  category: { id: SOURCE_SCOPE.categoryId, name: "DIPUTADO NACIONAL" },
  jurisdiction: { id: SOURCE_SCOPE.jurisdictionId, distrito_code: "02", seccion_code: "027" },
  elections: [{ id: SOURCE_SCOPE.electionId, year: 2025, round: "e2e-fiscalizacion" }],
  rows: [
    {
      election_id: SOURCE_SCOPE.electionId, jurisdiction_id: SOURCE_SCOPE.jurisdictionId,
      category_id: SOURCE_SCOPE.categoryId, granularity: "seccion", list_id: null,
      votes: OFFICIAL_VOTES, source_kind: "official", source_row_index: 0,
      archive_entry_id: "e2e-source-isolation-official",
    },
    {
      election_id: SOURCE_SCOPE.electionId, jurisdiction_id: SOURCE_SCOPE.jurisdictionId,
      category_id: SOURCE_SCOPE.categoryId, granularity: "seccion", list_id: null,
      votes: FISCALIZACION_VOTES, source_kind: "fiscalizacion", source_row_index: 1,
      archive_entry_id: "e2e-source-isolation-fiscalizacion",
    },
  ],
  archivePrefix: "e2e-source-isolation-",
};
function assertOperation(operation: SupabaseOperation, label: string): void {
  if (operation.error) throw new Error(`${label}: ${operation.error.message}`);
}
export async function withResultFixture<T>(seed: ResultFixtureSeed,
  run: () => Promise<T>): Promise<T> {
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
  await cleanup("result rows", admin.from("result_row").delete().like("archive_entry_id", `${seed.archivePrefix}%`));
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
