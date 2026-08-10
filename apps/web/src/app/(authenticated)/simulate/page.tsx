import { createHash } from "node:crypto";
import type { ReactNode } from "react";
import { z } from "zod";
import { GranularityBadge } from "@/components/GranularityBadge";
import { allocateSeats } from "@/domain/seat-allocation/allocate";
import { repeatedParams, stringParam } from "@/lib/results/query-params";
import {
  nationalInputSchema,
  pbaMunicipalInputSchema,
  pbaProvincialInputSchema,
} from "@/domain/seat-allocation/schemas";
import {
  composeCouncil,
  CouncilCompositionError,
  type CouncilComposition,
} from "@/domain/seat-allocation/council";
import type {
  AllocationInput,
  AllocationResult,
} from "@/domain/seat-allocation/types";
import { GRANULARITY, type Granularity } from "@/lib/results/types";
import { AllocationEvidence } from "./allocation-evidence";

interface SimulatePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface ParsedInput {
  input?: AllocationInput;
  projectionInput?: ProjectionInput;
  granularity?: Granularity;
  parseError?: string;
}

const projectionGranularitySchema = z.enum([
  GRANULARITY.MESA,
  GRANULARITY.ESTABLECIMIENTO,
  GRANULARITY.CIRCUITO,
  GRANULARITY.SECCION,
  GRANULARITY.DISTRITO,
]);

const projectionFields = {
  isProjection: z.literal(true),
  granularity: projectionGranularitySchema,
};

const projectionInputSchema = z.discriminatedUnion("level", [
  pbaMunicipalInputSchema.safeExtend(projectionFields),
  pbaProvincialInputSchema.safeExtend(projectionFields),
  nationalInputSchema.safeExtend(projectionFields),
]);

type ProjectionInput = z.infer<typeof projectionInputSchema>;

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
  throw new Error("projection input contains a non-JSON value");
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
          "Historical simulation is unavailable at this route: historical figures require " +
          "a trusted server-side loader with validated archived provenance.",
      };
    }
    const projection = projectionInputSchema.parse(decoded);
    const { granularity, ...input } = projection;
    return {
      input,
      projectionInput: projection,
      granularity,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        parseError: `the \`input\` query parameter is not a valid projection input: ${error.message}`,
      };
    }
    return { parseError: "invalid JSON in the `input` query parameter" };
  }
}

/**
 * Seat-simulation view (task 11.18) — wires Phase 10's `allocate.ts`
 * public boundary. The `AllocationInput` discriminated union (D3) and its
 * Zod 4 strict-object variants (D5) already reject an illegal level/field
 * pairing at parse time, so this page's own job is only to surface the
 * `allocateSeats` result or its rejection, never to re-implement either
 * statutory method.
 *
 * Deliberately a query-param JSON interface, not a rich form: task 11.18
 * scopes this page to wiring `allocate.ts`, and a full operator-facing
 * form is out of this phase's numbered scope.
 */
/**
 * LOM (Decreto-Ley 6769/58) Art. 2: 18 seats for a partido in the
 * 40.000-80.000 bracket. Coronel Rosales has 67.503 inhabitants (INDEC Censo
 * 2022). This is a SOURCED quantity, distinct from the seats a single election
 * renews — `composeCouncil` never derives one from the other.
 */
const COUNCIL_TOTAL_SEATS = 18;

/**
 * The partido these seat counts were verified for.
 *
 * 18 is LOM Art. 2 for the 40.000-80.000 bracket and Coronel Rosales has
 * 67.503 inhabitants (INDEC 2022), so the pair is specific to THIS partido.
 * Gating on `level === "pba_municipal"` applied it to every PBA partido: a
 * 12-, 20- or 24-seat council was refused with "LOM Art. 3 renews 9 of the 18"
 * -- a statutory claim that is false there -- and its valid allocation was
 * discarded. The jurisdiction is configuration, like every other pinned scope
 * on this site.
 */
const COUNCIL_JURISDICTION_LABEL = "Coronel de Marina Leonardo Rosales";

/**
 * LOM Art. 3 renews the council by halves every two years, so ONE election
 * fills 9 seats. Sourced from the statute exactly like the 18 above, and
 * never read from the request — `seatsToFill` is operator input.
 */
const COUNCIL_SEATS_PER_ELECTION = 9;

/** The shape `heldOver` must have before it crosses into the domain. */
const councilSeatHoldersSchema = z.array(
  z.strictObject({ listId: z.string().min(1), listName: z.string().min(1) }),
).length(COUNCIL_TOTAL_SEATS - COUNCIL_SEATS_PER_ELECTION, {
  error:
    "heldOver expected councilTotal - seatsUpForRenewal " +
    `(${COUNCIL_TOTAL_SEATS} - ${COUNCIL_SEATS_PER_ELECTION} = ` +
    `${COUNCIL_TOTAL_SEATS - COUNCIL_SEATS_PER_ELECTION}) seats`,
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
      `heldOver requires a supported council: pass council=${COUNCIL_JURISDICTION_LABEL}`,
    );
  }
  if (council === undefined) return {};
  if (council !== COUNCIL_JURISDICTION_LABEL) {
    throw new CouncilCompositionError(
      `unsupported council: this route supports only ${COUNCIL_JURISDICTION_LABEL}`,
    );
  }
  if (!input) return { council: COUNCIL_JURISDICTION_LABEL };
  if (input.level !== "pba_municipal") {
    throw new CouncilCompositionError(
      `${COUNCIL_JURISDICTION_LABEL} is available only for pba_municipal ` +
        `projections; got ${input.level}`,
    );
  }
  if (input.seatsToFill !== COUNCIL_SEATS_PER_ELECTION) {
    throw new CouncilCompositionError(
      `LOM Art. 3 renews ${COUNCIL_SEATS_PER_ELECTION} of the ` +
        `${COUNCIL_TOTAL_SEATS} council seats per election; this allocation ` +
        `fills ${input.seatsToFill}`,
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
        ? `the \`heldOver\` query parameter is not a valid heldOver roster: ${error.message}`
        : "invalid JSON in the `heldOver` query parameter",
    );
  }
}

export default async function SimulatePage({
  searchParams,
}: SimulatePageProps): Promise<ReactNode> {
  const params = await searchParams;

  // Refused BEFORE anything is read, like the other three routes: without
  // this, `?input=A&input=B` renders "Pass an `input` query parameter" for a
  // request that sent it twice, and a repeated `heldOver` skips the roster
  // with no statement at all.
  const repeated = repeatedParams(params);
  if (repeated.length > 0) {
    return (
      <main>
        <h1>Seat simulation</h1>
        <p role="alert">
          Refused: these query parameters were supplied more than once and
          cannot be resolved to one value: {repeated.join(", ")}.
        </p>
      </main>
    );
  }

  const { input, projectionInput, granularity, parseError } = parseInputParam(
    stringParam(params, "input"),
  );

  let result: AllocationResult | undefined;
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

  if (input && !councilError) {
    try {
      result = allocateSeats(input);
    } catch (error) {
      allocationError = error instanceof Error ? error.message : String(error);
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
  // Gated on the PARTIDO, not on the level: `?council=` names which one, and
  // this route only knows the seat counts for the one it was verified against.
  if (result && input && validatedCouncil.heldOver !== undefined) {
    try {
      if (result.seatAwards.length !== COUNCIL_SEATS_PER_ELECTION) {
        throw new CouncilCompositionError(
          `the allocation returned ${result.seatAwards.length} awards for ` +
            `${input.seatsToFill} seats; a roster cannot be composed from a ` +
            "partial allocation",
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
            listName: source?.listName ?? `unmapped (list ${award.listId})`,
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

  const inputTrace = projectionInput && result && !councilError
    ? suppliedInputTrace(
        projectionInput,
        validatedCouncil.council,
        validatedCouncil.heldOver,
      )
    : undefined;

  return (
    <main>
      <h1>Seat simulation</h1>
      <p>
        Pass an <code>input</code> query parameter with a JSON-encoded
        projection: <code>isProjection: true</code>, normalized{" "}
        <code>granularity</code>, <code>level</code>, <code>seatsToFill</code>,{" "}
        <code>lists</code>, and either the Hare-quota fields (PBA levels) or{" "}
        <code>padron</code>/<code>threshold</code> (national). Historical runs
        require trusted server-side archived data and are unavailable through
        query JSON.
      </p>
      {parseError ? <p role="alert">{parseError}</p> : null}
      {allocationError ? <p role="alert">{allocationError}</p> : null}
      {councilError ? <p role="alert">{councilError}</p> : null}
      {!input && !parseError ? (
        <p role="status">
          No simulation run: provide a valid input scenario to calculate seats.
        </p>
      ) : null}
      {result &&
      input?.level === "pba_municipal" &&
      councilJurisdiction === COUNCIL_JURISDICTION_LABEL &&
      !council &&
      !councilError ? (
        <p role="note">
          No council roster: pass a <code>heldOver</code> query parameter with
          the {COUNCIL_TOTAL_SEATS - COUNCIL_SEATS_PER_ELECTION} seats NOT up
          for renewal in this projection. They remain caller-supplied projection
          input, not trusted prior-election evidence. Ley 5109 Art. 121 resolves
          which sitting councillors leave by sorteo, which this route does not
          model.
        </p>
      ) : null}
      {council ? (
        <section aria-label="council-composition">
          <h2>
            Council roster: {council.councilTotal} seats,{" "}
            {council.seatsUpForRenewal} renewed this election
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
                  ? " (this projection)"
                  : " (held over, caller-supplied projection input)"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {result ? (
        <section aria-label="allocation-result">
          <h2>Result ({result.level})</h2>
          <p>Projection (hypothetical, caller supplied)</p>
          {granularity ? (
            <p>
              <strong>Input granularity:</strong>{" "}
              <GranularityBadge granularity={granularity} />
            </p>
          ) : null}
          {inputTrace ? (
            <p>
              Supplied-input trace (not archive provenance): sha256 {inputTrace}
            </p>
          ) : null}
          <AllocationEvidence result={result} />
        </section>
      ) : null}
    </main>
  );
}
