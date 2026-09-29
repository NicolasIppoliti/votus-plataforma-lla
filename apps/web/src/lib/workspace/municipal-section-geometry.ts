import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ARCHIVE_ID = "geography/cne-pba-sections";
const ARCHIVE_PATH = "archive/geography/cne-pba-sections.964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673.geojson";
const SHA256 = "964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673";
const SECTION_NAME = "Cnel. de Marina L.Rosales";
const CRS = "urn:ogc:def:crs:EPSG::4326";

interface Geometry { type: "MultiPolygon"; coordinates: number[][][][] }
interface VerifiedSection { status: "ok"; name: string; sha256: string; fetchedAt: string; geometry: Geometry }
export type MunicipalSectionResult = VerifiedSection | { status: "withheld" };

/** Reads the complete immutable archive before parsing; no remote WFS or client-side archive transfer. */
export async function loadMunicipalSectionGeometry(): Promise<MunicipalSectionResult> {
  try {
    const root = resolve(process.cwd(), "../..");
    const manifest = JSON.parse(await readFile(resolve(root, "archive-manifest.json"), "utf8")) as unknown;
    if (!isObject(manifest) || !Array.isArray(manifest.records)) return { status: "withheld" };
    const records = manifest.records.filter((record: unknown) => isObject(record) && record.id === ARCHIVE_ID);
    if (records.length !== 1) return { status: "withheld" };
    const record = records[0];
    if (!isObject(record) || record.archived_path !== ARCHIVE_PATH || record.sha256 !== SHA256 || record.mime !== "application/json" || record.status !== "ok" || record.bytes !== 30269143 || record.fetched_at !== "2026-09-24T03:29:24Z") return { status: "withheld" };
    const bytes = await readFile(resolve(root, ARCHIVE_PATH));
    if (bytes.length !== record.bytes || createHash("sha256").update(bytes).digest("hex") !== SHA256) return { status: "withheld" };
    const collection = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!isObject(collection) || collection.type !== "FeatureCollection" || !isObject(collection.crs) || collection.crs.type !== "name" || !isObject(collection.crs.properties) || collection.crs.properties.name !== CRS || !Array.isArray(collection.features)) return { status: "withheld" };
    const matching = collection.features.filter((feature: unknown) => isObject(feature) && isObject(feature.properties) && feature.properties.provincia === "Buenos Aires" && feature.properties.departamen === SECTION_NAME && feature.properties.cabecera === "Punta Alta" && feature.properties.gid === 30556);
    if (matching.length !== 1) return { status: "withheld" };
    const feature = matching[0];
    if (!isObject(feature) || feature.type !== "Feature" || !isObject(feature.geometry) || feature.geometry.type !== "MultiPolygon" || !validCoordinates(feature.geometry.coordinates)) return { status: "withheld" };
    return { status: "ok", name: SECTION_NAME, sha256: SHA256, fetchedAt: record.fetched_at, geometry: { type: "MultiPolygon", coordinates: feature.geometry.coordinates } };
  } catch {
    return { status: "withheld" };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validCoordinates(value: unknown): value is number[][][][] {
  if (!Array.isArray(value) || value.length === 0) return false;
  for (const polygon of value) {
    if (!Array.isArray(polygon) || polygon.length === 0) return false;
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) return false;
      for (const point of ring) {
        if (!Array.isArray(point) || point.length !== 2 || !point.every((axis: unknown) => typeof axis === "number" && Number.isFinite(axis)) || point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90) return false;
      }
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) return false;
    }
  }
  return true;
}
