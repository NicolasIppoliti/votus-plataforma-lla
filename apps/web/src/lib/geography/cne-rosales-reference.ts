import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * Slice 11 (#399): CNE 2025 reference geography for Coronel Rosales — circuit
 * outlines and voting locations — from the artifact written by
 * `etl/etl/cne_rosales_reference.py build`. The bytes must match the pinned
 * SHA-256 before parsing; every refusal returns a reason, never data.
 */
export const ROSALES_REFERENCE_SHA256 =
  "fee7cd013ecd6b646bb58683160b3b4e714e1b7394fc462070f3168cd3b24577";
export const ROSALES_REFERENCE_PATH = `data/geography/cne-rosales-2025-reference.${ROSALES_REFERENCE_SHA256}.json`;
export const ROSALES_REFERENCE_CAVEATS = [
  "cne_reference_not_official_results",
  "not_valid_for_historical_elections",
  "circuits_0248B_0248C_overlap",
  "locales_in_0248_not_assigned_to_sub_circuits",
] as const;

const count = z.number().int().nonnegative();
const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const source = z.strictObject({ archived_path: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/) });

const artifactSchema = z.strictObject({
  schema_version: z.literal(1),
  reference_only: z.literal(true),
  caveats: z
    .array(z.string())
    .refine((caveats) => caveats.length === ROSALES_REFERENCE_CAVEATS.length && caveats.every((caveat, index) => caveat === ROSALES_REFERENCE_CAVEATS[index])),
  counts: z.strictObject({
    circuits: count,
    locales: count,
    plotted_locales: count,
    unique_coordinate_pairs: count,
    mesas: count,
  }),
  mesa_range: z.strictObject({ first: z.literal(1), last: count }),
  exclusions: z.strictObject({ not_plotted: z.strictObject({ missing_coordinates: count }) }),
  sources: z.strictObject({
    "geography/cne-rosales-2025-locales": source,
    "geography/cne-rosales-2025-supplied-geojson": source,
  }),
  provenance: z.strictObject({ generator: z.literal("etl/etl/cne_rosales_reference.py") }),
  circuits: z
    .array(z.strictObject({
      code: z.string().regex(/^\d{4}[A-Z]?$/),
      coordinates: z.array(z.array(z.array(position).min(4)).min(1)).min(1),
    }))
    .min(1)
    .refine((circuits) => new Set(circuits.map((circuit) => circuit.code)).size === circuits.length),
  locales: z
    .array(z.strictObject({
      circuit: z.string().min(1),
      name: z.string().min(1),
      address: z.string().min(1),
      locality: z.string().min(1),
      mesa_count: z.number().int().positive(),
      mesa_from: z.number().int().positive(),
      mesa_to: z.number().int().positive(),
      coordinates: position.nullable(),
    }))
    .min(1),
});

export type RosalesReference = z.infer<typeof artifactSchema>;
export type RosalesReferenceRefusal =
  | "missing"
  | "hash_mismatch"
  | "invalid_artifact"
  | "count_mismatch"
  | "unknown_circuit"
  | "mesa_range_mismatch";
export type RosalesReferenceResult =
  | { ok: true; reference: RosalesReference }
  | { ok: false; reason: RosalesReferenceRefusal };

function refuse(reason: RosalesReferenceRefusal): RosalesReferenceResult {
  return { ok: false, reason };
}

export function parseRosalesReference(bytes: Buffer, expectedSha256: string): RosalesReferenceResult {
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) return refuse("hash_mismatch");
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    return refuse("invalid_artifact");
  }
  const parsed = artifactSchema.safeParse(raw);
  if (!parsed.success) return refuse("invalid_artifact");
  const reference = parsed.data;
  const { counts, locales, circuits } = reference;
  const plotted = locales.flatMap((locale) => (locale.coordinates ? [locale.coordinates.join(",")] : []));
  const mesas = locales.reduce((total, locale) => total + locale.mesa_count, 0);
  if (
    counts.circuits !== circuits.length ||
    counts.locales !== locales.length ||
    counts.plotted_locales !== plotted.length ||
    counts.unique_coordinate_pairs !== new Set(plotted).size ||
    reference.exclusions.not_plotted.missing_coordinates !== locales.length - plotted.length ||
    counts.mesas !== mesas ||
    reference.mesa_range.last !== mesas
  ) {
    return refuse("count_mismatch");
  }
  const codes = new Set(circuits.map((circuit) => circuit.code));
  if (locales.some((locale) => !codes.has(locale.circuit))) return refuse("unknown_circuit");
  // Ranges must tile 1..last exactly, in the artifact's mesa order.
  let expected = 1;
  for (const locale of locales) {
    if (locale.mesa_from !== expected || locale.mesa_to - locale.mesa_from + 1 !== locale.mesa_count) {
      return refuse("mesa_range_mismatch");
    }
    expected = locale.mesa_to + 1;
  }
  return { ok: true, reference };
}

type ReadBytes = (path: string) => Promise<Buffer>;

export async function loadRosalesReference(read: ReadBytes = readFile): Promise<RosalesReferenceResult> {
  let bytes: Buffer;
  try {
    bytes = await read(resolve(process.cwd(), ROSALES_REFERENCE_PATH));
  } catch {
    return refuse("missing");
  }
  return parseRosalesReference(bytes, ROSALES_REFERENCE_SHA256);
}
