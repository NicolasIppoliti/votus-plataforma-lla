import { describe, expect, it } from "vitest";
import { panoramaResultPlan } from "../../../e2e/panorama-result-fixture";

describe("Panorama browser results fixture", () => {
  it("provides two official categories in the same 2023 Rosales election with different positive totals", () => {
    const plan = panoramaResultPlan();
    expect(plan.election.year).toBe(2023);
    expect(plan.election.round).not.toContain("paso");
    expect(plan.categories.map(category => category.name)).toEqual(["PRESIDENTE Y VICE", "DIPUTADO NACIONAL"]);
    expect(plan.jurisdiction).toMatchObject({ distrito_code: "02", seccion_code: "027", mesa_code: 1 });
    expect(plan.jurisdiction.circuito_code).toBeTruthy();
    expect(plan.jurisdiction.establecimiento_code).toBeTruthy();
    expect(plan.archive).toMatchObject({ source_kind: "official", capability: "national" });
    expect(plan.rows).toHaveLength(2);
    expect(new Set(plan.rows.map(row => row.votes)).size).toBe(2);
    expect(plan.rows.map(row => row.category_id)).toEqual(plan.categories.map(category => category.id));
    for (const row of plan.rows) {
      expect(row).toMatchObject({ election_id: plan.election.id, jurisdiction_id: plan.jurisdiction.id, source_kind: "official", archive_entry_id: plan.archive.id });
      expect(row.list_id).toBeTruthy();
    }
  });

  it("isolates invocation-owned archives, elections and full mesa lineage", () => {
    const first = panoramaResultPlan();
    const second = panoramaResultPlan();
    expect(first.archive.id).not.toBe(second.archive.id);
    expect(first.election.id).not.toBe(second.election.id);
    expect(first.election.round).not.toBe(second.election.round);
    expect(first.jurisdiction.id).not.toBe(second.jurisdiction.id);
    expect(first.jurisdiction.establecimiento_code).not.toBe(second.jurisdiction.establecimiento_code);
  });
});
