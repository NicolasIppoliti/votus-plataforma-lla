import { createHash } from "node:crypto";
import { loadRosalesReference } from "@/lib/geography/cne-rosales-reference";
import type { ReactNode } from "react";
import { z } from "zod";
import { GranularityBadge } from "@/components/GranularityBadge";
import { allocateSeats } from "@/domain/seat-allocation/allocate";
import { repeatedParams, stringParam } from "@/lib/results/query-params";
import {
  composeCouncil,
  CouncilCompositionError,
  type CouncilComposition,
} from "@/domain/seat-allocation/council";
import type {
  AllocationInput,
  AllocationResult,
} from "@/domain/seat-allocation/types";
import type { Granularity } from "@/lib/results/types";
import { AllocationEvidence } from "./allocation-evidence";
import {
  projectionInputSchema,
  projectionToAllocationInput,
  type ProjectionInput,
} from "./projection-input";
import { SimulationForm } from "./simulation-form";
import {
  simulationSweep,
  simulationOriginalInputFromQuery,
  SimulationFormError,
  SWEEP_KEYS,
  transferBaselineFromQuery,
  type SimulationSweep,
} from "./simulation-form-adapter";
import { SIMULATION_COUNCIL } from "./simulation-configuration";
import { SeatDistribution } from "./seat-distribution";
import { RenewalStrip, SimulationComparison } from "./simulation-comparison";
import "./simulation.css";
import "./workbench.css";

interface SimulatePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface ParsedInput {
  input?: AllocationInput;
  projectionInput?: ProjectionInput;
  granularity?: Granularity;
  parseError?: string;
}

function allocationLevelLabel(level: AllocationResult["level"]): string {
  if (level === "pba_municipal") return "municipal de PBA";
  if (level === "pba_provincial") return "provincial de PBA";
  return "nacional";
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      )
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${canonicalJson(entry)}`,
      )
      .join(",")}}`;
  }
  throw new Error("la proyección contiene un valor que no es JSON");
}

function suppliedInputTrace(
  input: ProjectionInput,
  council: string | undefined,
  heldOver: CouncilComposition["heldOver"] | undefined,
): string {
  return createHash("sha256")
    .update(
      canonicalJson({ council: council ?? null, heldOver: heldOver ?? null, input }),
    )
    .digest("hex");
}

function allocationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("no positive-vote list clears")) {
    return "ninguna lista con votos supera el umbral del padrón; se rechaza una asignación vacía";
  }
  if (message.includes("MAYORIA is not implemented")) {
    return "MAYORIA no está implementada según la Ley 5109; se rechazó la asignación";
  }
  const incomplete = message.match(/cannot allocate all (\d+) seats from the supplied lists; only (\d+) seat awards were produced/);
  if (incomplete) {
    return `Asignación rechazada: se solicitaron ${incomplete[1]} bancas, pero solo se produjeron ${incomplete[2]} adjudicaciones con las listas que alcanzan el cociente Hare (Ley 5109, arts. 109–110). No se presenta un reparto parcial como completo.`;
  }
  if (message.includes("listed and unmodeled votes exceed the vote-coverage basis")) {
    return "Asignación rechazada: los votos de las listas y los no modelados superan el total informado; los totales no son consistentes.";
  }
  // Never surface raw allocator text: unknown refusals keep the generic Spanish statement.
  return "No se pudo completar la asignación porque los datos proporcionados no cumplen sus reglas.";
}

function parseInputParam(raw: string | undefined): ParsedInput {
  if (!raw) return {};
  try {
    const decoded: unknown = JSON.parse(raw);
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "isProjection" in decoded &&
      decoded.isProjection === false
    ) {
      return {
        parseError:
          "La simulación histórica no está disponible en esta ruta: las cifras históricas requieren " +
          "una carga confiable del servidor con procedencia archivada y validada.",
      };
    }
    const projection = projectionInputSchema.parse(decoded);
    return {
      input: projectionToAllocationInput(projection),
      projectionInput: projection,
      granularity: projection.granularity,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        parseError: "el parámetro de consulta `input` no contiene una proyección válida",
      };
    }
    return { parseError: "el parámetro de consulta `input` contiene JSON no válido" };
  }
}

/**
 * Shared form and deep-link configuration. Requests can select this exact
 * council, but cannot change either statutory seat count.
 */
const COUNCIL_TOTAL_SEATS = SIMULATION_COUNCIL.TOTAL_SEATS;
const COUNCIL_JURISDICTION_LABEL = SIMULATION_COUNCIL.JURISDICTION;
const COUNCIL_SEATS_PER_ELECTION = SIMULATION_COUNCIL.SEATS_PER_ELECTION;

/** The shape `heldOver` must have before it crosses into the domain. */
const councilSeatHoldersSchema = z.array(
  z.strictObject({ listId: z.string().min(1), listName: z.string().min(1) }),
).length(COUNCIL_TOTAL_SEATS - COUNCIL_SEATS_PER_ELECTION, {
  error:
    "heldOver requiere councilTotal - seatsUpForRenewal " +
    `(${COUNCIL_TOTAL_SEATS} - ${COUNCIL_SEATS_PER_ELECTION} = ` +
    `${COUNCIL_TOTAL_SEATS - COUNCIL_SEATS_PER_ELECTION}) bancas`,
});

interface CouncilInputParams {
  input: AllocationInput | undefined;
  council: string | undefined;
  rawHeldOver: string | undefined;
}

interface ValidatedCouncilInput {
  council?: typeof COUNCIL_JURISDICTION_LABEL;
  heldOver?: CouncilComposition["heldOver"];
}

function validateCouncilInput({
  input,
  council,
  rawHeldOver,
}: CouncilInputParams): ValidatedCouncilInput {
  if (rawHeldOver !== undefined && council === undefined) {
    throw new CouncilCompositionError(
      `heldOver requiere un concejo compatible: use council=${COUNCIL_JURISDICTION_LABEL}`,
    );
  }
  if (
    council !== undefined &&
    council !== COUNCIL_JURISDICTION_LABEL
  ) {
    throw new CouncilCompositionError(
      `concejo no compatible: esta ruta solo admite ${COUNCIL_JURISDICTION_LABEL}`,
    );
  }
  if (input?.level === "pba_municipal") {
    if (
      input.councilTotal !== undefined &&
      input.councilTotal !== SIMULATION_COUNCIL.TOTAL_SEATS
    ) {
      throw new CouncilCompositionError(
        `el concejo requiere ${SIMULATION_COUNCIL.TOTAL_SEATS} bancas; ` +
          `se recibió ${input.councilTotal}`,
      );
    }
    if (input.seatsToFill !== COUNCIL_SEATS_PER_ELECTION) {
      throw new CouncilCompositionError(
        `La LOM, art. 3, renueva ${COUNCIL_SEATS_PER_ELECTION} de las ` +
          `${COUNCIL_TOTAL_SEATS} bancas del concejo por elección; esta asignación ` +
          `cubre ${input.seatsToFill}`,
      );
    }
  }
  if (council === undefined) return {};
  if (!input) return { council: COUNCIL_JURISDICTION_LABEL };
  if (input.level !== "pba_municipal") {
    throw new CouncilCompositionError(
      `${COUNCIL_JURISDICTION_LABEL} solo está disponible para proyecciones ` +
        `pba_municipal; se recibió ${input.level}`,
    );
  }
  if (rawHeldOver === undefined) {
    return { council: COUNCIL_JURISDICTION_LABEL };
  }
  try {
    return {
      council: COUNCIL_JURISDICTION_LABEL,
      heldOver: councilSeatHoldersSchema.parse(JSON.parse(rawHeldOver)),
    };
  } catch (error) {
    throw new CouncilCompositionError(
      error instanceof z.ZodError
        ? "el parámetro de consulta `heldOver` no contiene una nómina válida"
        : "el parámetro de consulta `heldOver` contiene JSON no válido",
    );
  }
}

interface SweepResultProps {
  query: string;
  baselineError: string | undefined;
}

function SweepResult({ query, baselineError }: SweepResultProps) {
  if (!SWEEP_KEYS.some((key) => new URLSearchParams(query).has(key))) return null;
  let sweep: SimulationSweep | undefined;
  let requestError: string | undefined;
  try {
    if (baselineError) throw new SimulationFormError([baselineError]);
    sweep = simulationSweep(query);
  } catch (error) {
    requestError = error instanceof SimulationFormError ? error.messages.join(" ") : "Revise el escenario de base.";
  }
  if (!sweep) return <p role="alert">Muestreo rechazado; la base se conserva. {requestError}</p>;
  const amounts = sweep.amounts;
  const points = sweep.queries.map((pointQuery, index) => {
    let result: AllocationResult | undefined;
    let refusal: string | undefined;
    try {
      result = allocateSeats(projectionToAllocationInput(transferBaselineFromQuery(pointQuery)!));
    } catch (error) {
      refusal = allocationErrorMessage(error);
    }
    return { amount: amounts[index]!, query: pointQuery, result, refusal };
  });
  const valid = points.filter((point) => point.result !== undefined);
  const refusals = new Map<string, number>();
  for (const point of points) {
    if (point.refusal) refusals.set(point.refusal, (refusals.get(point.refusal) ?? 0) + 1);
  }
  const baseline = transferBaselineFromQuery(sweep.queries[0]!)!;
  function seats(result: AllocationResult, listId: string): number {
    return result.seatAwards.filter((award) => award.listId === listId).length;
  }
  return (
    <section data-testid="sweep-result" aria-label="Resultados del muestreo" className="simulation-sweep">
      <h2>Muestras de transferencia a total fijo</h2>
      <p>
        Proyección hipotética: {points.length} muestras evaluadas; {valid.length} válidas; {points.length - valid.length} rechazadas.
        La base y su resultado exacto no cambian. Sin probabilidades, garantías entre puntos ni umbral general para ganar bancas.
      </p>
      {sweep.shorterLastInterval ? <p>Último intervalo más corto: {sweep.lastInterval} votos.</p> : null}
      <p>Rechazos por motivo: {refusals.size === 0 ? "0 (ninguno)." : null}</p>
      {refusals.size ? (
        <ul>{[...refusals].map(([reason, count]) => <li key={reason}>{reason}: {count} muestras.</li>)}</ul>
      ) : null}
      <div className="table-scroll" role="region" aria-label="Muestras evaluadas" tabIndex={0}>
        <table className="data-table">
          <caption>Muestras evaluadas</caption>
          <thead>
            <tr>
              <th scope="col">Votos transferidos</th>
              <th scope="col">Estado</th>
              {baseline.lists.map((list) => <th scope="col" key={list.listId}>{list.listName} (bancas)</th>)}
              <th scope="col">Evidencia exacta</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.amount}>
                <th scope="row">{point.amount}</th>
                <td>{point.refusal ?? "Válida"}</td>
                {baseline.lists.map((list) => (
                  <td key={list.listId}>{point.result ? seats(point.result, list.listId) : "No disponible"}</td>
                ))}
                <td><a href={`/simulate?${point.query}`}>Ver escenario exacto: {point.amount} votos</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {valid.length ? (
        <div className="table-scroll" role="region" aria-label="Extremos de bancas observados" tabIndex={0}>
          <table className="data-table">
            <caption>Mínimo y máximo de bancas en las muestras válidas</caption>
            <thead>
              <tr><th scope="col">Lista</th><th scope="col">Mínimo de bancas</th><th scope="col">Máximo de bancas</th></tr>
            </thead>
            <tbody>
              {baseline.lists.map((list) => {
                const counts = valid.map((point) => seats(point.result!, list.listId));
                return (
                  <tr key={list.listId}>
                    <th scope="row">{list.listName}</th><td>{Math.min(...counts)}</td><td>{Math.max(...counts)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p role="alert">No hay muestras válidas: no se calculan extremos de bancas.</p>}
    </section>
  );
}

export default async function SimulatePage({
  searchParams,
}: SimulatePageProps): Promise<ReactNode> {
  const params = await searchParams;
  const requestQuery = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : Array.isArray(value) ? value.map((entry) => [key, entry]) : [],
    ),
  );
  requestQuery.sort();

  // Refused BEFORE anything is read, like the other three routes: without
  // this, `?input=A&input=B` renders "Pass an `input` query parameter" for a
  // request that sent it twice, and a repeated `heldOver` skips the roster
  // with no statement at all.
  const repeated = repeatedParams(params).filter((key) => !SWEEP_KEYS.some((sweepKey) => sweepKey === key));
  if (repeated.length > 0) {
    return (
      <main>
        <h1>Simulación de bancas</h1>
        <p role="alert">
          Se rechazó la solicitud: estos parámetros de consulta se proporcionaron más de una vez y
          no se pueden resolver a un único valor: {repeated.join(", ")}.
        </p>
      </main>
    );
  }

  const { input, projectionInput, granularity, parseError } = parseInputParam(
    stringParam(params, "input"),
  );

  let result: AllocationResult | undefined;
  let baseResult: AllocationResult | undefined;
  let baseProjection: ProjectionInput | undefined;
  let baseError: string | undefined;
  if (projectionInput) {
    try {
      baseProjection = simulationOriginalInputFromQuery(requestQuery.toString()) ?? undefined;
    } catch (error) {
      baseError = error instanceof SimulationFormError ? error.messages.join(" ") : "Base no disponible.";
    }
  } else if (requestQuery.has("baseInput")) {
    baseError = "La base proporcionada requiere un escenario válido.";
  }
  let allocationError: string | undefined;
  let council: CouncilComposition | undefined;
  let councilError: string | undefined;
  const rawHeldOver = stringParam(params, "heldOver");
  const councilJurisdiction = stringParam(params, "council");
  let validatedCouncil: ValidatedCouncilInput = {};

  if (!parseError) {
    try {
      validatedCouncil = validateCouncilInput({
        input,
        council: councilJurisdiction,
        rawHeldOver,
      });
    } catch (error) {
      councilError = error instanceof Error ? error.message : String(error);
    }
  }

  if (input && !councilError && !baseError) {
    try {
      // Both views cross the same authoritative server validation/allocation path.
      const baseInput = baseProjection ? projectionToAllocationInput(baseProjection) : input;
      validateCouncilInput({ input: baseInput, council: councilJurisdiction, rawHeldOver });
      baseResult = allocateSeats(baseInput);
      result = allocateSeats(input);
    } catch (error) {
      allocationError = allocationErrorMessage(error);
    }
  }

  // The 18-seat roster. `composeCouncil` had no production caller at all, so
  // the council the Concejo Deliberante actually has could not be reached from
  // any page — while the page showed 9 awards, which is a half-renewal, not a
  // council.
  //
  // `heldOver` is caller-supplied projection input, never historical evidence:
  // Ley 5109 Art. 121 resolves which sitting councillors leave by sorteo, a
  // different question this route does not source. Absent it there is no roster
  // to show, and the page says so instead of presenting the 9 as the council.
  // The statutory check runs on the ALLOCATION, not on whether a roster was
  // requested: it sat inside the `heldOver` branch, so a pba_municipal race
  // renewing 17 of 18 seats rendered its awards with no refusal whenever the
  // operator omitted an unrelated query param. LOM Art. 3 fixes the half at 9.
  // This route's `pba_municipal` input is fixed to the verified Coronel
  // Rosales configuration. Omitting `?council=` suppresses roster claims,
  // but it cannot change the statutory divisor or total.
  if (result && input && validatedCouncil.heldOver !== undefined) {
    try {
      if (result.seatAwards.length !== COUNCIL_SEATS_PER_ELECTION) {
        throw new CouncilCompositionError(
          `la asignación devolvió ${result.seatAwards.length} adjudicaciones para ` +
            `${input.seatsToFill} bancas; no se puede componer una nómina a partir de una ` +
            "asignación parcial",
        );
      }
      // PARSED, not cast. `?heldOver={}` or `[{"foo":1}]` reached
      // `composeCouncil` typed as a valid roster and rendered `undefined` as a
      // councillor — the same blind-cast hazard `aggregateTo` was validated
      // for on the compare page.
      council = composeCouncil({
        councilTotal: COUNCIL_TOTAL_SEATS,
        // Supplied projection input, not derived: `seatsToFill` is the Hare
        // divisor the statute fixes, and `seatAwards.length` is an OUTPUT that
        // can fall short on ties or exhausted remainders. Deriving one from the
        // other rebalances 18 against a renewal count nobody set.
        seatsUpForRenewal: COUNCIL_SEATS_PER_ELECTION,
        // The NAME the input carried, not the id. Feeding `listId` in as
        // `listName` rendered a roster of `110`, `999` as councillor names —
        // the value was on the input and got discarded on the way to the
        // display. Absent a match, labelled unmapped rather than as a number.
        newlyAllocated: result.seatAwards.map((award) => {
          const source = input?.lists.find(
            (list) => list.listId === award.listId,
          );
          return {
            listId: award.listId,
            listName: source?.listName ?? `sin mapear (lista ${award.listId})`,
          };
        }),
        heldOver: validatedCouncil.heldOver,
      });
    } catch (error) {
      councilError =
        error instanceof CouncilCompositionError || error instanceof Error
          ? error.message
          : String(error);
      result = undefined;
      council = undefined;
    }
  }

  const referenceResult = input?.level === "pba_municipal" && councilJurisdiction === SIMULATION_COUNCIL.JURISDICTION
    ? await loadRosalesReference()
    : undefined;
  const reference = referenceResult?.ok ? referenceResult.reference : undefined;

  const inputTrace = projectionInput && result && !councilError
    ? suppliedInputTrace(
        projectionInput,
        validatedCouncil.council,
        validatedCouncil.heldOver,
      )
    : undefined;

  return (
    <main className="simulation-page">
      <header className="simulation-page-header">
        <p>Espacio de trabajo / Simulación</p>
        <h1>Simulación de escenarios</h1>
        <p>Supuestos, no predicciones. Explore una hipótesis de transferencia, no un pronóstico electoral.</p>
        <span className="simulation-authored-badge">Datos aportados por quien consulta · no oficiales</span>
      </header>
      <SimulationForm requestKey={requestQuery.toString()} reference={reference} hasScenarioInput={projectionInput !== undefined}
        impact={result ? <RenewalStrip result={result}><SeatDistribution result={result} /></RenewalStrip> : null}
        baseImpact={result && baseResult ? <RenewalStrip result={baseResult}><SeatDistribution result={baseResult} /></RenewalStrip> : null}
        comparison={result && baseResult && projectionInput && baseProjection ? <SimulationComparison base={baseProjection} scenario={projectionInput} baseResult={baseResult} result={result} /> : null}>
      <SweepResult query={requestQuery.toString()} baselineError={baseError ?? councilError ?? parseError} />
      {baseError ? <p role="alert">{baseError}</p> : null}
      {parseError ? <p role="alert">{parseError}</p> : null}
      {allocationError ? <p role="alert">{allocationError}</p> : null}
      {councilError ? <p role="alert">{councilError}</p> : null}
      {!input && !parseError ? (
        <p role="status">
          No se ejecutó ninguna simulación: proporcione un escenario válido para calcular las bancas.
        </p>
      ) : null}
      {result &&
      input?.level === "pba_municipal" &&
      councilJurisdiction === COUNCIL_JURISDICTION_LABEL &&
      !council &&
      !councilError ? (
        <p role="note">
          No hay nómina del concejo: proporcione un parámetro <code>heldOver</code> con
          las {COUNCIL_TOTAL_SEATS - COUNCIL_SEATS_PER_ELECTION} bancas que NO se
          renuevan en esta proyección. Siguen siendo datos de proyección aportados
          por quien realiza la consulta, no evidencia confiable de la elección anterior.
          La Ley 5109, art. 121, determina por sorteo qué concejales en funciones dejan
          su banca; esta ruta no modela ese proceso.
        </p>
      ) : null}
      {council ? (
        <section data-testid="council-composition" aria-label="Composición del concejo">
          <h2>
            Nómina del concejo: {council.councilTotal} bancas,{" "}
            {council.seatsUpForRenewal} renovadas en esta elección
          </h2>
          <ul>
            {[
              ...council.newlyAllocated.map((seat) => ({
                seat,
                renewed: true,
              })),
              ...council.heldOver.map((seat) => ({ seat, renewed: false })),
            ].map(({ seat, renewed }, index) => (
              // Labelled from WHICH LIST the seat came from, not from its index
              // in `fullComposition`. The index version assumed an ordering
              // this file never checked, and every label would flip silently if
              // `composeCouncil` changed it.
              <li key={`${seat.listId}-${index}`}>
                {seat.listName}
                {renewed
                  ? " (esta proyección)"
                  : " (banca no renovada, dato de proyección aportado por quien consulta)"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {result ? (
        <section data-testid="allocation-result" aria-label="Resultado de la asignación">
          <h2>Resultado ({allocationLevelLabel(result.level)})</h2>
          <p>Proyección hipotética aportada por quien realiza la consulta</p>
          {granularity ? (
            <p>
              <strong>Granularidad de entrada:</strong>{" "}
              <GranularityBadge granularity={granularity} />
            </p>
          ) : null}
          {inputTrace ? (
            <p>
              Huella de los datos proporcionados (no es procedencia de archivo): sha256 {inputTrace}
            </p>
          ) : null}
          <details className="simulation-disclosure"><summary>Cómo se asignaron las bancas</summary>
            <AllocationEvidence result={result} />
          </details>
        </section>
      ) : null}
      </SimulationForm>
    </main>
  );
}
