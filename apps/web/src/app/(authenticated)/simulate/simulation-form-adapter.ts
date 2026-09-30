import type { AllocationLevel } from "@/domain/seat-allocation/types";
import type { Granularity } from "@/lib/results/types";
import {
  projectionInputSchema,
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

export function simulationScenarioQuery(scenario: SimulationScenario): string {
  const query = new URLSearchParams({ input: JSON.stringify(scenario.input) });
  if (scenario.council) query.set("council", scenario.council);
  query.sort();
  return query.toString();
}

/** Read the complete baseline independently of the narrower custom editor. */
export function transferBaselineFromQuery(query: string): ProjectionInput | null {
  const params = new URLSearchParams(query);
  if (params.getAll("input").length !== 1 ||
    [...params.keys()].some((key) => params.getAll(key).length !== 1)) return null;
  try {
    return projectionInputSchema.parse(JSON.parse(params.get("input") ?? ""));
  } catch {
    return null;
  }
}

/** Change only two vote counts; all other input and query evidence survives. */
export function transferSimulationQuery(
  query: string,
  donorId: string,
  targetId: string,
  amount: string,
): string {
  const input = transferBaselineFromQuery(query);
  if (!input) throw new SimulationFormError(["El escenario de base no es válido para transferir votos."]);
  const donor = input.lists.find((list) => list.listId === donorId);
  const target = input.lists.find((list) => list.listId === targetId);
  if (!donor || !target || donorId === targetId) {
    throw new SimulationFormError(["Seleccione una lista donante y una receptora existentes y distintas."]);
  }
  const votes = parseInteger(amount, "La cantidad a transferir");
  if (votes > donor.votes) {
    throw new SimulationFormError(["La cantidad a transferir no puede superar los votos de la lista donante."]);
  }
  if (!Number.isSafeInteger(target.votes + votes)) {
    throw new SimulationFormError(["La suma en la lista receptora supera el límite de entero seguro."]);
  }
  if (votes === 0) return query;
  const adjusted = {
    ...input,
    lists: input.lists.map((list) => list.listId === donorId
      ? { ...list, votes: list.votes - votes }
      : list.listId === targetId ? { ...list, votes: list.votes + votes } : list),
  };
  const params = new URLSearchParams(query);
  params.set("input", JSON.stringify(adjusted));
  params.sort();
  return params.toString();
}

export const SWEEP_KEYS = ["sweepDonor", "sweepTarget", "sweepMax", "sweepStep"] as const;

export function sweepBaselineQuery(query: string): string {
  const params = new URLSearchParams(query);
  for (const key of SWEEP_KEYS) params.delete(key);
  params.sort();
  return params.toString();
}

export interface SimulationSweep {
  amounts: number[];
  queries: string[];
  lastInterval: number;
  shorterLastInterval: boolean;
}

/** Conservative, unbenchmarked request guards; not universal timing guarantees. */
export function simulationSweep(query: string): SimulationSweep {
  const params = new URLSearchParams(query);
  const fields = SWEEP_KEYS.map((key) => {
    const entries = params.getAll(key);
    if (entries.length !== 1) throw new SimulationFormError(["Complete cada parámetro de muestreo una sola vez."]);
    return entries[0]!;
  });
  const [donor, target, rawMax, rawStep] = fields;
  const max = parseInteger(rawMax!, "El máximo a transferir");
  const step = parseInteger(rawStep!, "El paso", { positive: true });
  const baseline = sweepBaselineQuery(query);
  // Reuse W1's canonical, lossless operation, including identity and overflow checks.
  transferSimulationQuery(baseline, donor!, target!, String(max));
  const input = transferBaselineFromQuery(baseline)!;
  const intervals = Math.floor(max / step);
  const remainder = max % step;
  if (intervals >= 21) throw new SimulationFormError(["El muestreo supera el límite de 21 muestras. Reduzca el máximo o aumente el paso."]);
  const count = intervals + 1 + (remainder > 0 ? 1 : 0);
  if (count > 21) throw new SimulationFormError(["El muestreo supera el límite de 21 muestras. Reduzca el máximo o aumente el paso."]);
  if (input.seatsToFill > Math.floor(600 / count / input.lists.length)) {
    throw new SimulationFormError(["El muestreo supera el límite de 600 posiciones de trabajo (muestras × bancas × listas)."]);
  }
  const amounts = Array.from({ length: intervals + 1 }, (_, index) => index * step);
  if (remainder > 0) amounts.push(max);
  return {
    amounts,
    queries: amounts.map((amount) => transferSimulationQuery(baseline, donor!, target!, String(amount))),
    lastInterval: remainder || (max === 0 ? 0 : step),
    shorterLastInterval: remainder > 0,
  };
}

export function simulationSweepQuery(query: string, data: FormData): string {
  const params = new URLSearchParams(sweepBaselineQuery(query));
  for (const [index, name] of ["donor", "target", "max", "step"].entries()) {
    const entries = data.getAll(name);
    if (entries.length !== 1 || typeof entries[0] !== "string") {
      throw new SimulationFormError(["Complete cada campo de muestreo una sola vez."]);
    }
    params.set(SWEEP_KEYS[index]!, entries[0]);
  }
  params.sort();
  const request = params.toString();
  simulationSweep(request);
  return request;
}

/** Only restore scenarios the editor can reproduce without losing evidence. */
export function simulationValuesFromQuery(query: string): SimulationFormValues | null {
  const params = new URLSearchParams(query);
  if ([...params.keys()].some((key) => key !== "input" && key !== "council")) return null;
  if (params.getAll("input").length !== 1 || params.getAll("council").length > 1) return null;
  try {
    const input = projectionInputSchema.parse(JSON.parse(params.get("input") ?? ""));
    const values: SimulationFormValues = {
      level: input.level,
      granularity: input.granularity,
      seatsToFill: String(input.seatsToFill),
      totalVotes: input.totalVotes === undefined ? "" : String(input.totalVotes),
      blankVotes: input.level === "national" ? "0" : String(input.blankVotes ?? ""),
      annulledVotes: input.level === "national" ? "0" : String(input.annulledVotes ?? ""),
      padron: input.level === "national" ? String(input.padron) : "",
      thresholdPercent: input.level === "national" ? String(input.threshold.value) : "3",
      lists: input.lists.map((list) => ({
        id: list.listId,
        name: list.listName,
        votes: String(list.votes),
      })),
    };
    const restored = createSimulationScenario(values);
    return JSON.stringify(restored.input) === JSON.stringify(input) &&
      restored.council === (params.get("council") ?? undefined)
      ? values
      : null;
  } catch {
    return null;
  }
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

  return parsed.data.level === "pba_municipal"
    ? { input: parsed.data, council: SIMULATION_COUNCIL.JURISDICTION }
    : { input: parsed.data };
}
