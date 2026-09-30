import { describe, expect, it } from "vitest";
import {
  createSimulationScenario,
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
