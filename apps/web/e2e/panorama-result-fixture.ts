import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assertE2eEnvironment } from "./gate-contract";

/** Unique lineage and archive keep cleanup confined to this invocation. */
export function panoramaResultPlan() {
  const id = randomUUID();
  const election = { id: randomUUID(), year: 2023, round: `e2e-panorama-${id}` };
  const categories = ["PRESIDENTE Y VICE", "DIPUTADO NACIONAL"].map(name => ({ id: randomUUID(), name }));
  const jurisdiction = { id: randomUUID(), distrito_code: "02", distrito_name: "Buenos Aires",
    seccion_code: "027", seccion_name: "Coronel de Marina L. Rosales", circuito_code: "00001",
    circuito_name: "00001", establecimiento_code: `e2e-panorama-${id}`,
    establecimiento_name: "Synthetic Panorama school", mesa_code: 1 };
  const archive = { id: `national/e2e-panorama-${id}`, capability: "national", source: "example.test",
    source_url: `https://example.test/e2e-panorama-${id}`, sha256: createHash("sha256").update(id).digest("hex"),
    mime: "text/csv", fetched_at: "2026-08-10T00:00:00Z", status: "ok", source_kind: "official" };
  const rows = categories.map((category, index) => ({ election_id: election.id, category_id: category.id,
    jurisdiction_id: jurisdiction.id, archive_entry_id: archive.id, source_kind: "official",
    granularity: "mesa", list_id: "110", votes: index === 0 ? 11_111 : 7_777, source_row_index: index }));
  return { election, categories, jurisdiction, archive, rows };
}

/** Review authorization alone does not seed results. Categories are global catalog
 * entries: reuse existing names, and delete only catalog entries we inserted. */
export async function withPanoramaResults<T>(run: () => Promise<T>): Promise<T> {
  const environment = assertE2eEnvironment(process.env);
  const admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
  const plan = panoramaResultPlan();
  const ownedCategories: string[] = [];
  const owned: { election?: boolean; jurisdiction?: boolean; archive?: boolean } = {};
  function check(error: { message: string } | null) {
    if (error) throw new Error(`Panorama results fixture: ${error.message}`);
  }
  let outcome: { value: T } | { error: unknown };
  try {
    for (const [index, category] of plan.categories.entries()) {
      const { data, error } = await admin.from("category").select("id").eq("name", category.name).maybeSingle();
      check(error);
      if (data) {
        category.id = data.id;
        plan.rows[index]!.category_id = data.id;
      } else {
        check((await admin.from("category").insert(category)).error);
        ownedCategories.push(category.id);
      }
    }
    check((await admin.from("election").insert(plan.election)).error); owned.election = true;
    check((await admin.from("jurisdiction").insert(plan.jurisdiction)).error); owned.jurisdiction = true;
    check((await admin.from("archive_entry").insert(plan.archive)).error); owned.archive = true;
    check((await admin.from("result_row").insert(plan.rows)).error);
    outcome = { value: await run() };
  } catch (error) { outcome = { error }; }
  const errors: unknown[] = [];
  async function cleanup(operation: PromiseLike<{ error: { message: string } | null }>) {
    try { check((await operation).error); } catch (error) { errors.push(error); }
  }
  if (owned.archive) await cleanup(admin.from("result_row").delete().eq("archive_entry_id", plan.archive.id));
  if (owned.election) await cleanup(admin.from("election").delete().eq("id", plan.election.id));
  if (owned.archive) await cleanup(admin.from("archive_entry").delete().eq("id", plan.archive.id));
  if (owned.jurisdiction) await cleanup(admin.from("jurisdiction").delete().eq("id", plan.jurisdiction.id));
  if (ownedCategories.length) await cleanup(admin.from("category").delete().in("id", ownedCategories));
  if ("error" in outcome) errors.unshift(outcome.error);
  if (errors.length) throw new AggregateError(errors, "Panorama fixture or cleanup failed");
  return (outcome as { value: T }).value;
}
