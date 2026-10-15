import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SECTION_SOURCE, sectionArtifactSchema, sha256 } from "../geography/rosales-section-artifact";

export const SECTION_SHA256 = "d21df6a0ca949d64fbe4a4aa83c6d88695333be06d38321de00c1241bfd7a351";
export const SECTION_PATH = `data/geography/cne-rosales-section.${SECTION_SHA256}.json`;
interface Geometry { type: "MultiPolygon"; coordinates: number[][][][] }
interface VerifiedSection { status: "ok"; name: string; sha256: string; fetchedAt: string; geometry: Geometry }
export type MunicipalSectionResult = VerifiedSection | { status: "withheld" };

/** Only the small, pinned offline derivative is read during a page invocation. */
export async function loadMunicipalSectionGeometry(): Promise<MunicipalSectionResult> {
  try {
    const bytes = await readFile(resolve(process.cwd(), SECTION_PATH));
    if (sha256(bytes) !== SECTION_SHA256) return { status: "withheld" };
    const artifact = sectionArtifactSchema.parse(JSON.parse(bytes.toString("utf8")));
    return {
      status: "ok", name: artifact.feature.properties.departamen,
      // Preserve source provenance displayed by existing reference-only scenes.
      sha256: SECTION_SOURCE.sha256, fetchedAt: SECTION_SOURCE.fetched_at,
      geometry: artifact.feature.geometry,
    };
  } catch {
    return { status: "withheld" };
  }
}
