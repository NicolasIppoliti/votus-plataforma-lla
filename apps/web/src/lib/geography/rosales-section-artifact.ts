import { createHash } from "node:crypto";
import { z } from "zod";

export const SECTION_SOURCE = {
  id: "geography/cne-pba-sections",
  archived_path: "archive/geography/cne-pba-sections.964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673.geojson",
  sha256: "964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673",
  bytes: 30269143,
  fetched_at: "2026-09-24T03:29:24Z",
  source: "mapa2.electoral.gov.ar",
  mime: "application/json",
  status: "ok",
} as const;
export const SECTION_ATTRIBUTION = "CNE, mapa2.electoral.gov.ar. CNE/PBA catalog attributes CC BY 4.0 to circuit resource; license not separately verified for this sections layer.";
export const SECTION_IDENTITY = { provincia: "Buenos Aires", departamen: "Cnel. de Marina L.Rosales", cabecera: "Punta Alta", gid: 30556 } as const;
export const SECTION_CRS = "urn:ogc:def:crs:EPSG::4326";
export const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const ring = z.array(position).min(4).refine((points) => points.length >= 4 && points[0]![0] === points.at(-1)![0] && points[0]![1] === points.at(-1)![1]);
export const sectionFeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.object({ provincia: z.literal(SECTION_IDENTITY.provincia), departamen: z.literal(SECTION_IDENTITY.departamen), cabecera: z.literal(SECTION_IDENTITY.cabecera), gid: z.literal(SECTION_IDENTITY.gid) }).passthrough(),
  geometry: z.strictObject({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(ring).min(1)).min(1) }),
}).passthrough();
export const sectionArtifactSchema = z.strictObject({
  schema_version: z.literal(1),
  reference_only: z.literal(true),
  historical_applicability: z.literal("not_verified"),
  attribution: z.literal(SECTION_ATTRIBUTION),
  crs: z.literal(SECTION_CRS),
  source: z.strictObject({
    id: z.literal(SECTION_SOURCE.id), archived_path: z.literal(SECTION_SOURCE.archived_path),
    sha256: z.literal(SECTION_SOURCE.sha256), bytes: z.literal(SECTION_SOURCE.bytes),
    fetched_at: z.literal(SECTION_SOURCE.fetched_at), source: z.literal(SECTION_SOURCE.source),
    mime: z.literal(SECTION_SOURCE.mime), status: z.literal(SECTION_SOURCE.status),
  }),
  generator: z.literal("apps/web/scripts/generate-rosales-section.ts"),
  transformation: z.literal("selection_only_no_repair_no_simplification"),
  feature: sectionFeatureSchema,
});

/** Offline only: validate the pinned manifest and complete original before selecting. */
export function deriveRosalesSection(manifest: unknown, bytes: Buffer): Buffer {
  const parsed = z.object({ records: z.array(z.unknown()) }).parse(manifest);
  const records = parsed.records.filter((r) => typeof r === "object" && r !== null && "id" in r && r.id === SECTION_SOURCE.id);
  if (records.length !== 1 || !Object.entries(SECTION_SOURCE).every(([key, value]) => (records[0] as Record<string, unknown>)[key] === value)) throw new Error("source_manifest_mismatch");
  if (bytes.length !== SECTION_SOURCE.bytes || sha256(bytes) !== SECTION_SOURCE.sha256) throw new Error("source_bytes_mismatch");
  const collection = z.object({ type: z.literal("FeatureCollection"), crs: z.object({ type: z.literal("name"), properties: z.object({ name: z.literal(SECTION_CRS) }) }), features: z.array(z.unknown()) }).parse(JSON.parse(bytes.toString("utf8")));
  const matches = collection.features.filter((feature) => {
    if (typeof feature !== "object" || feature === null || !("properties" in feature)) return false;
    const properties = feature.properties as Record<string, unknown> | null;
    return typeof properties === "object" && properties !== null && Object.entries(SECTION_IDENTITY).every(([key, value]) => properties[key] === value);
  });
  if (matches.length !== 1) throw new Error("section_identity_not_unique");
  sectionFeatureSchema.parse(matches[0]);
  // Serialize the original feature, not schema-transformed or repaired coordinates.
  return Buffer.from(JSON.stringify({
    schema_version: 1, reference_only: true, historical_applicability: "not_verified",
    attribution: SECTION_ATTRIBUTION, crs: SECTION_CRS, source: SECTION_SOURCE,
    generator: "apps/web/scripts/generate-rosales-section.ts",
    transformation: "selection_only_no_repair_no_simplification", feature: matches[0],
  }) + "\n");
}
