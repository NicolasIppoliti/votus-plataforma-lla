import { expect, it } from "vitest";
import { MAX_RETURN_DESTINATION_LENGTH, returnDestination } from "./return-destination";
import { loadScenarioArtifact } from "@/lib/scenarios/scenario-artifact";
import { loadScenarioSimulation } from "@/lib/scenarios/scenario-simulation";
import {
  simulationScenarioQuery, simulationSweep, simulationSweepQuery, transferSimulationQuery,
} from "@/app/(authenticated)/simulate/simulation-form-adapter";
import { SIMULATION_COUNCIL } from "@/app/(authenticated)/simulate/simulation-configuration";

it("measures shipped scenario links and their generated transfer/sweep URLs", async () => {
  const artifact = await loadScenarioArtifact();
  expect(artifact.ok).toBe(true);
  if (!artifact.ok) throw new Error(artifact.reason);
  const measurements: { scenario: string; kind: string; length: number }[] = [];
  for (const scenario of artifact.artifact.scenarios) {
    const loaded = await loadScenarioSimulation(scenario.id);
    if (!loaded) throw new Error("Shipped scenario cannot load");
    const base = simulationScenarioQuery({ input: loaded.input, council: SIMULATION_COUNCIL.JURISDICTION });
    const donor = loaded.input.lists[0]!, target = loaded.input.lists[1]!;
    const transfer = transferSimulationQuery(base, donor.listId, target.listId, "1");
    const form = new FormData();
    for (const [key, value] of Object.entries({ donor: donor.listId, target: target.listId, max: String(donor.votes - 1), step: String(donor.votes - 1) })) form.set(key, value);
    const sweep = simulationSweepQuery(transfer, form);
    for (const [kind, query] of [
      ["scenario", `scenario=${encodeURIComponent(scenario.id)}`], ["editor", base],
      ["transfer", transfer], ["sweep", sweep],
      ...simulationSweep(sweep).queries.map((query, index) => [`sample-${index}`, query]),
    ]) {
      const url = `/simulate?${query}`;
      expect(returnDestination(url)).toBe(url);
      measurements.push({ scenario: scenario.id, kind: kind!, length: url.length });
    }
  }
  console.info("SCENARIO_RETURN_URL_LENGTHS", JSON.stringify(measurements));
  const longest = Math.max(...measurements.map(row => row.length));
  expect(longest).toBe(2542);
  expect(MAX_RETURN_DESTINATION_LENGTH).toBeGreaterThanOrEqual(longest * 3);
});
