/**
 * Type-level proof that applying the wrong statutory method to a level is
 * a COMPILE error (design.md D3), not merely a runtime check. This file
 * is checked by `tsc --noEmit`; it is never executed by vitest.
 */
import type { HareInput, DhondtInput } from "./types";

// A PBA input MUST NOT carry a `threshold` field: Ley 5109 has no
// fixed-percentage piso, the derived cuociente is the only bar (D5).
export const illegalHareInput: HareInput = {
  level: "pba_municipal",
  totalVotes: 100,
  blankVotes: 0,
  annulledVotes: 0,
  unmodeledVotes: 100,
  seatsToFill: 9,
  isProjection: false,
  lists: [],
  // @ts-expect-error HareInput has no `threshold` field — this pairing must fail to compile.
  threshold: { value: 3, basis: "padron" },
};

// A national input MUST NOT carry a `cuociente` field: national diputados
// use D'Hondt quotients, never the PBA cuociente electoral.
export const illegalDhondtInput: DhondtInput = {
  level: "national",
  padron: 100,
  totalVotes: 0,
  unmodeledVotes: 0,
  threshold: { value: 3, basis: "padron" },
  seatsToFill: 5,
  isProjection: false,
  lists: [],
  // @ts-expect-error DhondtInput has no `cuociente` field — this pairing must fail to compile.
  cuociente: 10,
};
