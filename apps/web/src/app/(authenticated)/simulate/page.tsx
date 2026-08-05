import type { ReactNode } from "react";
import { allocateSeats } from "@/domain/seat-allocation/allocate";
import type { AllocationInput, AllocationResult } from "@/domain/seat-allocation/types";

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
    return { input: JSON.parse(raw) as AllocationInput };
  } catch {
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
export default async function SimulatePage({ searchParams }: SimulatePageProps): Promise<ReactNode> {
  const params = await searchParams;
  const raw = params["input"];
  const { input, parseError } = parseInputParam(typeof raw === "string" ? raw : undefined);

  let result: AllocationResult | undefined;
  let allocationError: string | undefined;

  if (input) {
    try {
      result = allocateSeats(input);
    } catch (error) {
      allocationError = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <main>
      <h1>Seat simulation</h1>
      <p>
        Pass an <code>input</code> query parameter with a JSON-encoded
        `AllocationInput` (design.md D3) — `level`, `seatsToFill`, `lists`, and either
        the Hare-quota fields (PBA levels) or `padron`/`threshold` (national).
      </p>
      {parseError ? <p role="alert">{parseError}</p> : null}
      {allocationError ? <p role="alert">{allocationError}</p> : null}
      {result ? (
        <section aria-label="allocation-result">
          <h2>Result ({result.level})</h2>
          <p>{result.isProjection ? "Projection (hypothetical)" : "Historical run"}</p>
          <ul>
            {result.seatAwards.map((award, index) => (
              <li key={`${award.listId}-${index}`}>
                {award.listId}: {award.awardedBy}
                {award.tieBreak
                  ? ` (tie-break: ${award.tieBreak.rule}, ${award.tieBreak.basis})`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
