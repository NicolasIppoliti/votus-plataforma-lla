import { describe, expect, it } from "vitest";
import {
  createSimulationScenario,
  SimulationFormError,
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

  it("rejects inconsistent PBA totals through domain validation", () => {
    expect(() =>
      createSimulationScenario({
        ...MUNICIPAL_VALUES,
        totalVotes: "100",
        blankVotes: "60",
        annulledVotes: "50",
        lists: [{ id: "list-1", name: "Lista A", votes: "0" }],
      }),
    ).toThrowError(/totales de votos/i);
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
