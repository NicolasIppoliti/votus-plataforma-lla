import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ID = "geography/ign-buenos-aires-province";
const SHA = "314600f9b681841b9f35c27fac030c835de6a95cbf4a0c4256a39df6c069f723";
const PATH = `archive/geography/ign-buenos-aires-province.${SHA}.geojson`;
const BYTES = 10282974;
const FETCHED_AT = "2026-09-28T04:26:37Z";
const SOURCE = "wms.ign.gob.ar";
const CRS = "urn:ogc:def:crs:EPSG::4326";

function object(value: unknown): value is Record<string, unknown> {
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

export async function loadProvinceReferenceGeometry() {
  try {
    const root = resolve(process.cwd(), "../..");
    const manifest = JSON.parse(await readFile(resolve(root, "archive-manifest.json"), "utf8")) as unknown;
    if (!object(manifest) || !Array.isArray(manifest.records)) return null;
    const records = manifest.records.filter((record: unknown) => object(record) && record.id === ID);
    if (records.length !== 1) return null;
    const record = records[0];
    if (!object(record) || record.archived_path !== PATH || record.sha256 !== SHA || record.bytes !== BYTES || record.mime !== "application/json" || record.status !== "ok" || record.fetched_at !== FETCHED_AT || record.source !== SOURCE || record.capability !== "geography") return null;
    const bytes = await readFile(resolve(root, PATH));
    if (bytes.length !== BYTES || createHash("sha256").update(bytes).digest("hex") !== SHA) return null;
    const collection = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!object(collection) || collection.type !== "FeatureCollection" || !object(collection.crs) || collection.crs.type !== "name" || !object(collection.crs.properties) || collection.crs.properties.name !== CRS || !Array.isArray(collection.features) || collection.features.length !== 1 || collection.totalFeatures !== 1 || collection.numberMatched !== 1 || collection.numberReturned !== 1) return null;
    const feature = collection.features[0];
    if (!object(feature) || feature.type !== "Feature" || feature.id !== "provincia.68" || !object(feature.properties) || feature.properties.in1 !== "06" || feature.properties.fna !== "Provincia de Buenos Aires" || feature.properties.nam !== "Buenos Aires" || !object(feature.geometry) || feature.geometry.type !== "MultiPolygon" || !validCoordinates(feature.geometry.coordinates)) return null;
    return { type: "Feature" as const, properties: {}, geometry: { type: "MultiPolygon" as const, coordinates: feature.geometry.coordinates } };
  } catch {
    return null;
  }
}
