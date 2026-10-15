import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { TestInfo } from "@playwright/test";
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
export async function withPanoramaResults<T>(run: (fixture: {
  election: { id: string; label: string };
  categories: { id: string; name: string }[];
}) => Promise<T>, info?: Pick<TestInfo, "outputPath">): Promise<T> {
  const environment = assertE2eEnvironment(process.env);
  const admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
  const plan = panoramaResultPlan();
  const ownedCategories: string[] = [];
  const owned: { election?: boolean; jurisdiction?: boolean; archive?: boolean } = {};
  let step = "start";
  const failures: { step: string; errorClass: string; sqlState?: string }[] = [];
  async function recordFailure(error: unknown) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    failures.push({ step, errorClass: error instanceof Error ? error.name : "DatabaseError",
      ...(typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? { sqlState: code } : {}) });
    if (info) await writeFile(info.outputPath("e2e-facts-panorama-fixture.json"), JSON.stringify({
      failures, owned: { ...owned, categoryCount: ownedCategories.length },
    }));
  }
  function check(error: { message: string; code?: string } | null) {
    if (error) throw Object.assign(new Error(`Panorama results fixture: ${error.message}`), { code: error.code });
  }
  let outcome: { value: T } | { error: unknown };
  try {
    for (const [index, category] of plan.categories.entries()) {
      step = `category-${index}-lookup`;
      const { data, error } = await admin.from("category").select("id").eq("name", category.name).maybeSingle();
      check(error);
      if (data) {
        category.id = data.id;
        plan.rows[index]!.category_id = data.id;
      } else {
        step = `category-${index}-insert`;
        check((await admin.from("category").insert(category)).error);
        ownedCategories.push(category.id);
      }
    }
    step = "election-insert";
    check((await admin.from("election").insert(plan.election)).error); owned.election = true;
    step = "jurisdiction-insert";
    check((await admin.from("jurisdiction").insert(plan.jurisdiction)).error); owned.jurisdiction = true;
    step = "archive-insert";
    check((await admin.from("archive_entry").insert(plan.archive)).error); owned.archive = true;
    step = "results-insert";
    check((await admin.from("result_row").insert(plan.rows)).error);
    step = "review-workspace-and-browser-journey";
    outcome = { value: await run({
      election: { id: plan.election.id, label: `${plan.election.year} ${plan.election.round}` },
      categories: plan.categories,
    }) };
  } catch (error) {
    outcome = { error };
    try { await recordFailure(error); } catch { /* Diagnostics must not prevent owned cleanup. */ }
  }
  const errors: unknown[] = [];
  async function cleanup(name: string, operation: PromiseLike<{ error: { message: string; code?: string } | null }>) {
    step = `cleanup-${name}`;
    try { check((await operation).error); } catch (error) {
      errors.push(error);
      try { await recordFailure(error); } catch { /* Preserve the original failure. */ }
    }
  }
  if (owned.archive) await cleanup("results", admin.from("result_row").delete().eq("archive_entry_id", plan.archive.id));
  if (owned.election) await cleanup("election", admin.from("election").delete().eq("id", plan.election.id));
  if (owned.archive) await cleanup("archive", admin.from("archive_entry").delete().eq("id", plan.archive.id));
  if (owned.jurisdiction) await cleanup("jurisdiction", admin.from("jurisdiction").delete().eq("id", plan.jurisdiction.id));
  if (ownedCategories.length) await cleanup("categories", admin.from("category").delete().in("id", ownedCategories));
  if ("error" in outcome) errors.unshift(outcome.error);
  if (errors.length) throw new AggregateError(errors, "Panorama fixture or cleanup failed");
  return (outcome as { value: T }).value;
}
