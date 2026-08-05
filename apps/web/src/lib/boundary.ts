import { z } from "zod";

/**
 * Scaffolding schema proving Zod 4 is wired for boundary validation.
 *
 * This is intentionally trivial (Phase 1). Real boundary schemas — the
 * seat-allocation discriminated union (`AllocationInput`) and the results
 * repository query envelope — are added in later phases per design.md D3.
 */
const BOUNDARY_ENVELOPE_SCHEMA = z.strictObject({
  source: z.string().min(1),
});

export type BoundaryEnvelope = z.infer<typeof BOUNDARY_ENVELOPE_SCHEMA>;

export function parseBoundaryEnvelope(
  input: unknown,
): ReturnType<typeof BOUNDARY_ENVELOPE_SCHEMA.safeParse> {
  return BOUNDARY_ENVELOPE_SCHEMA.safeParse(input);
}
