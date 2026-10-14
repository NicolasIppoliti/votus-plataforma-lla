"use server";
import { loadRosalesReference } from "@/lib/geography/cne-rosales-reference";
import { normalizeExplorationParams } from "@/lib/results/exploration";
import { loadMunicipalSectionGeometry } from "@/lib/workspace/municipal-section-geometry";

export async function loadSectionReferenceGeometry() {
  const result = await loadMunicipalSectionGeometry();
  return result.status === "ok" ? result : null;
}

/** Public reference geometry only: no locales, votes, session or protected evidence. */
export async function loadCircuitGeometry() {
  const result = await loadRosalesReference();
  if (!result.ok) return null;
  return result.reference.circuits.map(c => {
    const normalized = normalizeExplorationParams({ circuitoCode: c.code });
    return { code: normalized.status === "ok" ? normalized.value.circuitoCode! : c.code, coordinates: c.coordinates };
  });
}
