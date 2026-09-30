import { describe, expect, it } from "vitest";
import {
  createSimulationScenario,
  simulationSweep,
  simulationSweepQuery,
  sweepBaselineQuery,
  SimulationFormError,
  simulationScenarioQuery,
  transferBaselineFromQuery,
  transferSimulationQuery,
  type SimulationFormValues,
} from "./simulation-form-adapter";

const MUNICIPAL_VALUES: SimulationFormValues = {
  level: "pba_municipal",
  granularity: "seccion",
  seatsToFill: "",
  totalVotes: "10000",
  blankVotes: "100",
  annulledVotes: "50",
  padron: "",
  thresholdPercent: "",
  lists: [
    { id: "list-1", name: "Lista A", votes: "6000" },
    { id: "list-2", name: "Lista B", votes: "3850" },
  ],
};

const NATIONAL_VALUES: SimulationFormValues = {
  level: "national",
  granularity: "distrito",
  seatsToFill: "2",
  totalVotes: "16000",
  blankVotes: "",
  annulledVotes: "",
  padron: "100000",
  thresholdPercent: "3",
  lists: [
    { id: "list-1", name: "Lista A", votes: "10000" },
    { id: "list-2", name: "Lista B", votes: "6000" },
  ],
};

describe("complete transfer query boundary", () => {
  const query = simulationScenarioQuery(createSimulationScenario(MUNICIPAL_VALUES));
  it("returns the original query verbatim for zero and preserves the baseline", () => {
    expect(transferSimulationQuery(query, "list-1", "list-2", "0")).toBe(query);
    const adjusted = transferBaselineFromQuery(transferSimulationQuery(query, "list-1", "list-2", "6000"));
    expect(adjusted?.lists.map((list) => list.votes)).toEqual([0, 9850]);
    expect(transferBaselineFromQuery(query)?.lists.map((list) => list.votes)).toEqual([6000, 3850]);
  });
  it("rejects duplicate list identities and repeated query values, never picking the first", () => {
    const scenario = createSimulationScenario(MUNICIPAL_VALUES);
    scenario.input.lists[1]!.listId = "list-1";
    for (const invalid of [simulationScenarioQuery(scenario), `${query}&input=%7B%7D`, `${query}&council=other`]) {
      expect(transferBaselineFromQuery(invalid)).toBeNull();
      expect(() => transferSimulationQuery(invalid, "list-1", "list-2", "0"))
        .toThrow(SimulationFormError);
    }
  });
});

describe("bounded sweep query boundary", () => {
  const baseline = simulationScenarioQuery(createSimulationScenario(MUNICIPAL_VALUES));
  function request(max: string, step: string, query = baseline, donor = "list-1", target = "list-2") {
    const data = new FormData();
    for (const [key, value] of Object.entries({ max, step, donor, target })) data.set(key, value);
    return simulationSweepQuery(query, data);
  }

  it.each([
    ["1000", "500", [0, 500, 1000]], ["1000", "600", [0, 600, 1000]],
    ["0", "1", [0]], ["10", "20", [0, 10]],
  ])("includes both endpoints exactly once: maximum %s, step %s", (max, step, amounts) => {
    const query = request(max, step);
    const sweep = simulationSweep(query);
    expect(sweep.amounts).toEqual(amounts);
    expect(sweepBaselineQuery(query)).toBe(baseline);
    expect(sweep.queries.every((point) => !new URLSearchParams(point).has("sweepMax"))).toBe(true);
    for (const [index, point] of sweep.queries.entries()) {
      const original = transferBaselineFromQuery(baseline)!;
      expect(transferBaselineFromQuery(point)).toEqual({ ...original, lists: [
        { ...original.lists[0], votes: 6000 - amounts[index]! },
        { ...original.lists[1], votes: 3850 + amounts[index]! },
      ] });
    }
  });

  it("accepts 21 samples and rejects 22 without thinning or clamping", () => {
    expect(simulationSweep(request("20", "1")).amounts).toHaveLength(21);
    expect(() => request("21", "1")).toThrow("21 muestras");
    expect(() => request("41", "2")).toThrow("21 muestras");
  });

  it("accepts exactly 600 aggregate work slots and rejects one sample beyond", () => {
    const scenario = createSimulationScenario(NATIONAL_VALUES);
    scenario.input.seatsToFill = 10;
    scenario.input.lists.push({ listId: "zero", listName: "Lista cero", votes: 0 });
    const query = simulationScenarioQuery(scenario);
    expect(simulationSweep(request("19", "1", query)).amounts).toHaveLength(20);
    expect(() => request("20", "1", query)).toThrow("600 posiciones");
    scenario.input.seatsToFill = Number.MAX_SAFE_INTEGER;
    expect(() => request("0", "1", simulationScenarioQuery(scenario))).toThrow("600 posiciones");
  });

  it.each([
    ["-1", "1"], ["0.5", "1"], ["9007199254740992", "1"], ["", "1"],
    ["1", "0"], ["1", "-1"], ["1", "0.5"], ["1", "9007199254740992"], ["6001", "1"],
  ])("rejects invalid maximum/step before generating samples: %s/%s", (max, step) => {
    expect(() => request(max, step)).toThrow(SimulationFormError);
  });

  it("rejects unsafe preloop sample counts, identities, duplicates and receiver overflow", () => {
    const scenario = createSimulationScenario(NATIONAL_VALUES);
    scenario.input.lists[0]!.votes = Number.MAX_SAFE_INTEGER;
    scenario.input.lists[1]!.votes = 0;
    expect(() => request(String(Number.MAX_SAFE_INTEGER), "1", simulationScenarioQuery(scenario))).toThrow("21 muestras");
    for (const [donor, target] of [["list-1", "list-1"], ["unknown", "list-2"], ["", "list-2"]]) {
      expect(() => request("0", "1", baseline, donor, target)).toThrow("existentes y distintas");
    }
    const repeated = `${request("0", "1")}&sweepMax=1`;
    expect(() => simulationSweep(repeated)).toThrow("una sola vez");
    const data = new FormData();
    data.append("donor", "list-1"); data.append("donor", "list-2");
    expect(() => simulationSweepQuery(baseline, data)).toThrow("una sola vez");
    scenario.input.lists[0]!.votes = 1;
    scenario.input.lists[1]!.votes = Number.MAX_SAFE_INTEGER;
    expect(() => request("1", "1", simulationScenarioQuery(scenario))).toThrow("entero seguro");
    scenario.input.lists[1]!.listId = "list-1";
    expect(() => request("0", "1", simulationScenarioQuery(scenario))).toThrow(SimulationFormError);
  });
});

describe("simulation form adapter", () => {
  it("builds the canonical municipal projection and derives the fixed council", () => {
    expect(createSimulationScenario(MUNICIPAL_VALUES)).toEqual({
      council: "Coronel de Marina Leonardo Rosales",
      input: {
        level: "pba_municipal",
        granularity: "seccion",
        totalVotes: 10000,
        blankVotes: 100,
        annulledVotes: 50,
        unmodeledVotes: 0,
        unmodeledVoteBreakdown: [],
        seatsToFill: 9,
        councilTotal: 18,
        isProjection: true,
        lists: [
          { listId: "list-1", listName: "Lista A", votes: 6000 },
          { listId: "list-2", listName: "Lista B", votes: 3850 },
        ],
      },
    });
  });

  it("builds the canonical national projection with a padrón threshold", () => {
    expect(createSimulationScenario(NATIONAL_VALUES)).toEqual({
      input: {
        level: "national",
        granularity: "distrito",
        padron: 100000,
        totalVotes: 16000,
        threshold: { value: 3, basis: "padron" },
        unmodeledVotes: 0,
        unmodeledVoteBreakdown: [],
        seatsToFill: 2,
        isProjection: true,
        lists: [
          { listId: "list-1", listName: "Lista A", votes: 10000 },
          { listId: "list-2", listName: "Lista B", votes: 6000 },
        ],
      },
    });
  });

  it("prepares shape-valid PBA totals for authoritative server validation", () => {
    expect(() =>
      createSimulationScenario({
        ...MUNICIPAL_VALUES,
        totalVotes: "100",
        blankVotes: "60",
        annulledVotes: "50",
        lists: [{ id: "list-1", name: "Lista A", votes: "0" }],
      }),
    ).not.toThrow();
  });

  it("rejects missing and duplicate lists with Spanish errors", () => {
    for (const lists of [
      [],
      [
        { id: "list-1", name: "Lista A", votes: "6000" },
        { id: "list-1", name: "Lista B", votes: "3850" },
      ],
    ]) {
      expect(() =>
        createSimulationScenario({ ...MUNICIPAL_VALUES, lists }),
      ).toThrow(SimulationFormError);
      expect(() =>
        createSimulationScenario({ ...MUNICIPAL_VALUES, lists }),
      ).toThrowError(/lista/i);
    }
  });
});
