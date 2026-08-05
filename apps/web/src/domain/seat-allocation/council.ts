/**
 * Coronel Rosales Concejo Deliberante half-renewal roster.
 *
 * LOM (Decreto-Ley 6769/58) Art. 2 sets the council at 18 seats for a
 * partido in the 40.000-80.000 population bracket (Coronel Rosales:
 * 67.503 inhabitants, INDEC Censo 2022); Art. 3 renews the council by
 * halves every two years, so a single election allocates only 9 seats.
 * `councilTotal` and `seatsUpForRenewal` are distinct, sourced quantities
 * per spec.md "Council total and seats per election are distinct
 * quantities" - this module never derives one from the other.
 */

export interface CouncilSeatHolder {
  listId: string;
  listName: string;
}

export interface CouncilComposition {
  councilTotal: number;
  seatsUpForRenewal: number;
  /** Seats awarded by this election's Hare allocation. */
  newlyAllocated: CouncilSeatHolder[];
  /**
   * Seats NOT up for renewal this election. This is sourced input from a
   * prior election's composition, never recomputed here - Ley 5109 Art.
   * 121 resolves which sitting councillors leave first by sorteo, a
   * different (out-of-scope) question from seat allocation.
   */
  heldOver: CouncilSeatHolder[];
  fullComposition: CouncilSeatHolder[];
}

export class CouncilCompositionError extends Error {}

export function composeCouncil(args: {
  councilTotal: number;
  seatsUpForRenewal: number;
  newlyAllocated: CouncilSeatHolder[];
  heldOver: CouncilSeatHolder[];
}): CouncilComposition {
  if (args.newlyAllocated.length !== args.seatsUpForRenewal) {
    throw new CouncilCompositionError(
      `newlyAllocated has ${args.newlyAllocated.length} seats, expected exactly ` +
        `seatsUpForRenewal (${args.seatsUpForRenewal}).`,
    );
  }

  const expectedHeldOver = args.councilTotal - args.seatsUpForRenewal;
  if (args.heldOver.length !== expectedHeldOver) {
    throw new CouncilCompositionError(
      `heldOver has ${args.heldOver.length} seats, expected councilTotal - seatsUpForRenewal ` +
        `(${args.councilTotal} - ${args.seatsUpForRenewal} = ${expectedHeldOver}).`,
    );
  }

  return {
    councilTotal: args.councilTotal,
    seatsUpForRenewal: args.seatsUpForRenewal,
    newlyAllocated: args.newlyAllocated,
    heldOver: args.heldOver,
    fullComposition: [...args.newlyAllocated, ...args.heldOver],
  };
}
