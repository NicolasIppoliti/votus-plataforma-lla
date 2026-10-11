import { expect, it } from "vitest";
import { assertResultFixtureOwnership, pasoFixture } from "./result-fixture";
import { pasoInternasFixture } from "./paso-internas-fixture";

it("owns the PASO seeded rows, mappings and named identities exactly", () => {
  const { identity, seed } = pasoFixture("e2e/provenance.spec.ts");
  expect(assertResultFixtureOwnership("e2e/provenance.spec.ts", seed, "paso")).toEqual([identity.archiveEntryIds[0]]);
  expect(seed.rows.map((row) => [row["list_id"], row["votes"]])).toEqual(pasoInternasFixture.section_lists.map((list) => [list.list_id, list.votes]));
  expect(seed.listIdentities).toHaveLength(3);
  expect(seed.rows.some((row) => row["votes"] === 0)).toBe(true);
  expect(seed.rows.every((row) => row["source_kind"] === "official")).toBe(true);
  expect(() => assertResultFixtureOwnership("e2e/provenance.spec.ts", { ...seed, rows: seed.rows.slice(1) }, "paso")).toThrow("owned identity");
});
