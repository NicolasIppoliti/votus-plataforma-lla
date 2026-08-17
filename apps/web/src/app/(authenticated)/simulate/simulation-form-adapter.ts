import { allocateSeats } from "@/domain/seat-allocation/allocate";
import type { AllocationLevel } from "@/domain/seat-allocation/types";
import type { Granularity } from "@/lib/results/types";
import {
  projectionInputSchema,
  projectionToAllocationInput,
  type ProjectionInput,
} from "./projection-input";
import { SIMULATION_COUNCIL } from "./simulation-configuration";

export interface SimulationFormListValues {
  id: string;
  name: string;
  votes: string;
}

export interface SimulationFormValues {
  level: AllocationLevel;
  granularity: Granularity;
  seatsToFill: string;
  totalVotes: string;
  blankVotes: string;
  annulledVotes: string;
  padron: string;
  thresholdPercent: string;
  lists: SimulationFormListValues[];
}

export interface SimulationScenario {
  input: ProjectionInput;
  council?: typeof SIMULATION_COUNCIL.JURISDICTION;
}

export class SimulationFormError extends Error {
  readonly messages: readonly string[];

  constructor(messages: readonly string[]) {
    super(messages.join(" "));
    this.name = "SimulationFormError";
    this.messages = messages;
  }
}

interface IntegerOptions {
  positive?: boolean;
}

function parseInteger(
  value: string,
  label: string,
  { positive = false }: IntegerOptions = {},
): number {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new SimulationFormError([
      `${label} debe ser un número entero ${positive ? "mayor que cero" : "igual o mayor que cero"}.`,
    ]);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || (positive ? parsed <= 0 : parsed < 0)) {
    throw new SimulationFormError([
      `${label} debe ser un número entero ${positive ? "mayor que cero" : "igual o mayor que cero"}.`,
    ]);
  }
  return parsed;
}

function parsePercentage(value: string): number {
  const normalized = value.trim().replace(",", ".");
  const parsed = Number(normalized);
  if (normalized.length === 0 || !Number.isFinite(parsed) || parsed < 0) {
    throw new SimulationFormError([
      "El porcentaje de umbral debe ser un número igual o mayor que cero.",
    ]);
  }
  return parsed;
}

function parseLists(values: SimulationFormListValues[]) {
  if (values.length === 0) {
    throw new SimulationFormError(["Agregue al menos una lista."]);
  }

  const ids = new Set<string>();
  return values.map((list, index) => {
    const listNumber = index + 1;
    const id = list.id.trim();
    const name = list.name.trim();
    if (id.length === 0) {
      throw new SimulationFormError([
        `La lista ${listNumber} no tiene un identificador estable.`,
      ]);
    }
    if (ids.has(id)) {
      throw new SimulationFormError([
        "Cada lista debe tener un identificador único.",
      ]);
    }
    ids.add(id);
    if (name.length === 0) {
      throw new SimulationFormError([
        `Ingrese el nombre de la lista ${listNumber}.`,
      ]);
    }
    return {
      listId: id,
      listName: name,
      votes: parseInteger(list.votes, `Los votos de la lista ${listNumber}`),
    };
  });
}

function parsePbaVoteTotals(values: SimulationFormValues) {
  return {
    totalVotes: parseInteger(values.totalVotes, "El total de votos"),
    blankVotes: parseInteger(values.blankVotes, "Los votos en blanco"),
    annulledVotes: parseInteger(values.annulledVotes, "Los votos anulados"),
  };
}

function domainErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("totalVotes") ||
    message.includes("blank") ||
    message.includes("annulled") ||
    message.includes("vote-coverage basis") ||
    message.includes("padrón")
  ) {
    return "Los totales de votos no son consistentes entre sí ni con los votos de las listas.";
  }
  if (message.includes("positive-vote list clears")) {
    return "Ninguna lista con votos supera el umbral indicado.";
  }
  return "Los datos ingresados no permiten realizar una asignación de bancas válida.";
}

export function createSimulationScenario(
  values: SimulationFormValues,
): SimulationScenario {
  const lists = parseLists(values.lists);
  let candidate: unknown;

  if (values.level === "national") {
    candidate = {
      level: values.level,
      granularity: values.granularity,
      padron: parseInteger(values.padron, "El padrón", { positive: true }),
      totalVotes: parseInteger(values.totalVotes, "El total de votos"),
      threshold: {
        value: parsePercentage(values.thresholdPercent),
        basis: "padron",
      },
      unmodeledVotes: 0,
      unmodeledVoteBreakdown: [],
      seatsToFill: parseInteger(values.seatsToFill, "Las bancas a asignar", {
        positive: true,
      }),
      isProjection: true,
      lists,
    };
  } else {
    candidate = {
      level: values.level,
      granularity: values.granularity,
      ...parsePbaVoteTotals(values),
      unmodeledVotes: 0,
      unmodeledVoteBreakdown: [],
      seatsToFill:
        values.level === "pba_municipal"
          ? SIMULATION_COUNCIL.SEATS_PER_ELECTION
          : parseInteger(values.seatsToFill, "Las bancas a asignar", {
              positive: true,
            }),
      ...(values.level === "pba_municipal"
        ? { councilTotal: SIMULATION_COUNCIL.TOTAL_SEATS }
        : {}),
      isProjection: true,
      lists,
    };
  }

  const parsed = projectionInputSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new SimulationFormError([
      "Revise los campos del escenario: contienen valores no admitidos.",
    ]);
  }

  try {
    allocateSeats(projectionToAllocationInput(parsed.data));
  } catch (error) {
    throw new SimulationFormError([domainErrorMessage(error)]);
  }

  return parsed.data.level === "pba_municipal"
    ? { input: parsed.data, council: SIMULATION_COUNCIL.JURISDICTION }
    : { input: parsed.data };
}
