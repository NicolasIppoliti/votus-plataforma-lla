import { expect, it, vi } from "vitest";
import nextConfig from "../next.config";
import { SCENARIO_ARTIFACT_PATH } from "@/lib/scenarios/scenario-artifact";

vi.mock("server-only", () => ({}));

it("includes the verified province archive and manifest in the geography route trace", () => {
  expect(nextConfig.outputFileTracingIncludes?.["/api/geography/buenos-aires"]).toEqual([
    "../../archive-manifest.json",
    "../../archive/geography/ign-buenos-aires-province.314600f9b681841b9f35c27fac030c835de6a95cbf4a0c4256a39df6c069f723.geojson",
  ]);
});

it("includes the pinned scenario artifact in the /scenarios route trace", () => {
  expect(nextConfig.outputFileTracingIncludes?.["/scenarios"]).toEqual([`./${SCENARIO_ARTIFACT_PATH}`]);
});
