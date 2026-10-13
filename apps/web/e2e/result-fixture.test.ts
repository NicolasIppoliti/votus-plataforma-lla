import { expect, it } from "vitest";
import { assertResultFixtureOwnership, pasoFixture, completenessFixture } from "./result-fixture";
import { pasoInternasFixture } from "./paso-internas-fixture";

it("owns the completeness catalogue and statuses exactly", () => {
  const spec = "e2e/provenance.spec.ts";
  const { seed } = completenessFixture(spec);
  expect(assertResultFixtureOwnership(spec, seed)).toHaveLength(2);
  expect(seed.officialExpectedMesas).toHaveLength(3);
  expect(seed.officialMesaCountStatuses?.map((row) => row["count_status"])).toEqual(["counted", "not_counted"]);
  for (const key of ["election_id", "archive_entry_id", "distrito_code", "seccion_code", "mesa_code"] as const) {
    const rows = seed.officialExpectedMesas!.map((row, index) => index === 0 ? { ...row, [key]: "unowned" } : row);
    expect(() => assertResultFixtureOwnership(spec, { ...seed, officialExpectedMesas: rows })).toThrow();
  }
  expect(() => assertResultFixtureOwnership(spec, { ...seed, officialExpectedMesas: seed.officialExpectedMesas!.slice(1) })).toThrow();
  expect(() => assertResultFixtureOwnership(spec, { ...seed, officialMesaCountStatuses: [...seed.officialMesaCountStatuses!, seed.officialMesaCountStatuses![0]!] })).toThrow();
});

it("owns the PASO seeded rows, mappings and named identities exactly", () => {
  const { identity, seed } = pasoFixture("e2e/provenance.spec.ts");
  expect(assertResultFixtureOwnership("e2e/provenance.spec.ts", seed, "paso")).toEqual([identity.archiveEntryIds[0]]);
  expect(seed.rows.map((row) => [row["list_id"], row["votes"]])).toEqual(pasoInternasFixture.section_lists.map((list) => [list.list_id, list.votes]));
  expect(seed.listIdentities).toHaveLength(3);
  expect(seed.rows.some((row) => row["votes"] === 0)).toBe(true);
  expect(seed.rows.every((row) => row["source_kind"] === "official")).toBe(true);
  expect(() => assertResultFixtureOwnership("e2e/provenance.spec.ts", { ...seed, rows: seed.rows.slice(1) }, "paso")).toThrow("owned identity");
});
