import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { EXPECTED_E2E_SPECS } from "./gate-contract";

it("includes the unskipped first-run journey in the release gate's municipal scenario", () => {
  expect(EXPECTED_E2E_SPECS).toContain("e2e/municipal.spec.ts");
  const spec = readFileSync(new URL("./municipal.spec.ts", import.meta.url), "utf8");
  expect(spec).toContain('test("first-run: a fresh sole-organization user reaches Rosales results in three clicks"');
  const journeyStart = spec.indexOf('// #467');
  const journey = spec.slice(journeyStart, spec.indexOf('nextTest(', journeyStart));
  expect(journey).not.toMatch(/test\.(skip|fixme|only)|test\.fail\(/);
  expect(journey.match(/\.click\(\)/g)).toHaveLength(3);
});
