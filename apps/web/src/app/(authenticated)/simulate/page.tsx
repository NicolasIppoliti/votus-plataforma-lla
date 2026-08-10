import type { ReactNode } from "react";
import { z } from "zod";
import { allocateSeats } from "@/domain/seat-allocation/allocate";
import { repeatedParams, stringParam } from "@/lib/results/query-params";
import { allocationInputSchema } from "@/domain/seat-allocation/schemas";
import {
  composeCouncil,
  CouncilCompositionError,
  type CouncilComposition,
} from "@/domain/seat-allocation/council";
import type {
  AllocationInput,
  AllocationResult,
} from "@/domain/seat-allocation/types";
import { AllocationEvidence } from "./allocation-evidence";

interface SimulatePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface ParsedInput {
  input?: AllocationInput;
  parseError?: string;
}

function parseInputParam(raw: string | undefined): ParsedInput {
  if (!raw) return {};
  try {
    // PARSED against the D5 schema, not cast. `heldOver` was validated with an
    // explicit note about the blind-cast hazard while this one was trusted —
    // and `input.seatsToFill` / `input.lists` are read BEFORE `allocateSeats`
    // ever sees it, so `?input={}` surfaced a TypeError string as a council
    // error instead of a stated refusal.
    return { input: allocationInputSchema.parse(JSON.parse(raw)) };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        parseError: `the \`input\` query parameter is not a valid AllocationInput: ${error.message}`,
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
  z.object({ listId: z.string().min(1), listName: z.string().min(1) }),
);

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

  const { input, parseError } = parseInputParam(stringParam(params, "input"));

  let result: AllocationResult | undefined;
  let allocationError: string | undefined;
  let council: CouncilComposition | undefined;
  let councilError: string | undefined;

  if (input) {
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
  // `heldOver` is SOURCED INPUT from the prior election, never derived here:
  // Ley 5109 Art. 121 resolves which sitting councillors leave by sorteo, a
  // different question this system does not answer. Absent it there is no
  // roster to show, and the page says so instead of presenting the 9.
  const rawHeldOver = stringParam(params, "heldOver");

  // The statutory check runs on the ALLOCATION, not on whether a roster was
  // requested: it sat inside the `heldOver` branch, so a pba_municipal race
  // renewing 17 of 18 seats rendered its awards with no refusal whenever the
  // operator omitted an unrelated query param. LOM Art. 3 fixes the half at 9.
  // Gated on the PARTIDO, not on the level: `?council=` names which one, and
  // this route only knows the seat counts for the one it was verified against.
  const councilJurisdiction = stringParam(params, "council");
  if (
    result &&
    input?.level === "pba_municipal" &&
    councilJurisdiction === COUNCIL_JURISDICTION_LABEL &&
    input.seatsToFill !== COUNCIL_SEATS_PER_ELECTION
  ) {
    councilError =
      `LOM Art. 3 renews ${COUNCIL_SEATS_PER_ELECTION} of the ` +
      `${COUNCIL_TOTAL_SEATS} council seats per election; this allocation ` +
      `fills ${input.seatsToFill}`;
    result = undefined;
  }

  if (result && input && rawHeldOver !== undefined) {
    try {
      if (
        input.level !== "pba_municipal" ||
        councilJurisdiction !== COUNCIL_JURISDICTION_LABEL
      ) {
        // 18 seats is LOM Art. 2 for a PBA PARTIDO in the 40.000-80.000
        // bracket — Coronel Rosales. Composing that roster from a national
        // allocation (D'Hondt, Ley 19.945 Art. 161) attaches a municipal
        // council to a race that does not elect one.
        throw new CouncilCompositionError(
          `a council roster is defined only for ${COUNCIL_JURISDICTION_LABEL} at the ` +
            `pba_municipal level; got level ${input.level} and council ` +
            `${councilJurisdiction ?? "(unspecified)"}`,
        );
      }
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
      const heldOver = councilSeatHoldersSchema.parse(JSON.parse(rawHeldOver));
      council = composeCouncil({
        councilTotal: COUNCIL_TOTAL_SEATS,
        // SOURCED, not derived: `seatsToFill` is the Hare divisor the statute
        // fixes, and `seatAwards.length` is an OUTPUT that can fall short on
        // ties or exhausted remainders. Deriving one from the other rebalances
        // 18 against a renewal count nobody set.
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
        heldOver,
      });
    } catch (error) {
      councilError =
        error instanceof CouncilCompositionError || error instanceof Error
          ? error.message
          : String(error);
    }
  }

  return (
    <main>
      <h1>Seat simulation</h1>
      <p>
        Pass an <code>input</code> query parameter with a JSON-encoded
        `AllocationInput` (design.md D3) — `level`, `seatsToFill`, `lists`, and
        either the Hare-quota fields (PBA levels) or `padron`/`threshold`
        (national).
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
          for renewal this election. They are sourced from the prior election,
          never derived here — Ley 5109 Art. 121 resolves which sitting
          councillors leave by sorteo, which this system does not model.
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
                {renewed ? " (this election)" : " (held over)"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {result ? (
        <section aria-label="allocation-result">
          <h2>Result ({result.level})</h2>
          <p>
            {result.isProjection
              ? "Projection (hypothetical)"
              : "Historical run"}
          </p>
          <AllocationEvidence result={result} />
        </section>
      ) : null}
    </main>
  );
}
