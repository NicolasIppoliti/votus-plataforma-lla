import { z } from "zod";
import {
  nationalInputSchema,
  pbaMunicipalInputSchema,
  pbaProvincialInputSchema,
} from "@/domain/seat-allocation/schemas";
import type { AllocationInput } from "@/domain/seat-allocation/types";
import { GRANULARITY } from "@/lib/results/types";

export const projectionGranularitySchema = z.enum([
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

export const projectionInputSchema = z.discriminatedUnion("level", [
  pbaMunicipalInputSchema.safeExtend(projectionFields),
  pbaProvincialInputSchema.safeExtend(projectionFields),
  nationalInputSchema.safeExtend(projectionFields),
]);

export type ProjectionInput = z.infer<typeof projectionInputSchema>;

export function projectionToAllocationInput(
  projection: ProjectionInput,
): AllocationInput {
  const { granularity: _granularity, ...input } = projection;
  return input;
}
