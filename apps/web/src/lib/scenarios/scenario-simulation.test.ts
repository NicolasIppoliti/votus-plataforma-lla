import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SIMULATION_COUNCIL } from "../../app/(authenticated)/simulate/simulation-configuration";
import { loadScenarioSimulation, scenarioVotes } from "./scenario-simulation";
import { createSimulationScenario, simulationScenarioQuery, simulationValuesFromQuery } from "../../app/(authenticated)/simulate/simulation-form-adapter";

it("opens both artifact scenarios in the editor without changing vote evidence", async () => {
  for (const id of ["persistencia", "transferencias_ei"]) {
    const scenario = await loadScenarioSimulation(id);
    expect(scenario).toBeDefined();
    const values = simulationValuesFromQuery(simulationScenarioQuery({ input: scenario!.input, council: SIMULATION_COUNCIL.JURISDICTION }));
    expect(values).not.toBeNull();
    expect(values!.lists.map((list) => Number(list.votes))).toEqual(scenario!.votes);
    expect(createSimulationScenario(values!).input).toEqual(scenario!.input);
    expect(values!.validVotesOnly).toBe(true);
    const edited = createSimulationScenario({ ...values!, lists: values!.lists.map((list, index) => ({ ...list, votes: String(Number(list.votes) + (index === 0 ? -1 : index === 1 ? 1 : 0)) })) });
    if (edited.input.level === "national") throw new Error("Expected municipal scenario");
    expect(edited.input.voteTotals).toEqual({ kind: "valid_votes_only", validVotes: 32291 });
    expect(edited.input.totalVotes).toBeUndefined();
    expect(edited.input.blankVotes).toBeUndefined();
    expect(edited.input.annulledVotes).toBeUndefined();
  }
});

describe("scenarioVotes", () => {
  it("recovers exact persistence votes and refuses fractional persistence", () => {
    expect(scenarioVotes(["14550/32291", "17741/32291"], true).votes).toEqual([14550, 17741]);
    expect(() => scenarioVotes(["1/2", "1/2"], true)).toThrow();
  });
  it("breaks equal remainders by larger share then artifact order", () => {
    expect(scenarioVotes(["1/6", "5/6"], false).votes).toEqual([5382, 26909]);
    expect(scenarioVotes(["1/2", "1/2"], false).votes).toEqual([16146, 16145]);
  });
  it("rejects shares that do not sum to one", () => {
    expect(() => scenarioVotes(["1/3"], false)).toThrow();
  });
});
