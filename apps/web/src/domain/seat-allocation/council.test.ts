import { describe, expect, it } from "vitest";
import { composeCouncil, CouncilCompositionError } from "./council";

/**
 * LOM (Decreto-Ley 6769/58) Art. 2/3: Coronel Rosales' Concejo Deliberante
 * has 18 seats TOTAL and renews 9 per election, every two years. These are
 * two distinct quantities (spec.md "Council total and seats per election
 * are distinct quantities"); this module tracks the half-renewal roster,
 * combining freshly allocated seats with the sourced held-over half.
 */

describe("composeCouncil", () => {
  it("combines the newly allocated seats with the held-over seats into the full 18-seat council", () => {
    const newlyAllocated = Array.from({ length: 9 }, (_, i) => ({
      listId: `new-${i}`,
      listName: `New List ${i}`,
    }));
    const heldOver = Array.from({ length: 9 }, (_, i) => ({
      listId: `held-${i}`,
      listName: `Held List ${i}`,
    }));

    const result = composeCouncil({
      councilTotal: 18,
      seatsUpForRenewal: 9,
      newlyAllocated,
      heldOver,
    });

    expect(result.fullComposition).toHaveLength(18);
    expect(result.newlyAllocated).toHaveLength(9);
    expect(result.heldOver).toHaveLength(9);
    // Held-over seats must remain distinguishable as sourced input, not
    // recomputed by this election's allocation.
    expect(result.heldOver.every((seat) => seat.listId.startsWith("held-"))).toBe(true);
  });

  it("rejects a composition whose newly-allocated count does not match seatsUpForRenewal", () => {
    const newlyAllocated = Array.from({ length: 8 }, (_, i) => ({
      listId: `new-${i}`,
      listName: `New List ${i}`,
    }));
    const heldOver = Array.from({ length: 9 }, (_, i) => ({
      listId: `held-${i}`,
      listName: `Held List ${i}`,
    }));

    expect(() =>
      composeCouncil({ councilTotal: 18, seatsUpForRenewal: 9, newlyAllocated, heldOver }),
    ).toThrow(CouncilCompositionError);
  });

  it("rejects a composition whose held-over count does not fill the remaining seats", () => {
    const newlyAllocated = Array.from({ length: 9 }, (_, i) => ({
      listId: `new-${i}`,
      listName: `New List ${i}`,
    }));
    const heldOver = Array.from({ length: 7 }, (_, i) => ({
      listId: `held-${i}`,
      listName: `Held List ${i}`,
    }));

    expect(() =>
      composeCouncil({ councilTotal: 18, seatsUpForRenewal: 9, newlyAllocated, heldOver }),
    ).toThrow(CouncilCompositionError);
  });
});
