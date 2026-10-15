import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { SECTION_SOURCE, SECTION_IDENTITY, SECTION_CRS, sha256 } from "../geography/rosales-section-artifact";
import { loadMunicipalSectionGeometry, SECTION_PATH } from "./municipal-section-geometry";

const checkout = resolve("../..");
const root = process.env.VOTUS_SECTION_SOURCE_ROOT ?? (existsSync(resolve(checkout, SECTION_SOURCE.archived_path)) ? checkout : resolve(checkout, "../../votus-plataforma-lla"));

it.skipIf(!existsSync(resolve(root, SECTION_SOURCE.archived_path)))("reports a bounded old/new loader measurement, not a latency guarantee", async () => {
  // The old request algorithm: manifest read/check, complete file read/hash/parse,
  // unique identity selection and ring checks. No remote fetch, cache or repair.
  async function oldLoader() {
    const manifest = JSON.parse(await readFile(resolve(root, "archive-manifest.json"), "utf8"));
    const records = manifest.records.filter((r: { id: string }) => r.id === SECTION_SOURCE.id);
    expect(records).toHaveLength(1);
    for (const [key, value] of Object.entries(SECTION_SOURCE)) expect(records[0][key]).toBe(value);
    const bytes = await readFile(resolve(root, SECTION_SOURCE.archived_path));
    expect(bytes.length).toBe(SECTION_SOURCE.bytes);
    expect(sha256(bytes)).toBe(SECTION_SOURCE.sha256);
    const collection = JSON.parse(bytes.toString("utf8"));
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.crs).toEqual({ type: "name", properties: { name: SECTION_CRS } });
    const matching = collection.features.filter((f: { properties: Record<string, unknown> }) => Object.entries(SECTION_IDENTITY).every(([key, value]) => f.properties[key] === value));
    expect(matching).toHaveLength(1);
    const geometry = matching[0].geometry;
    expect(geometry.type).toBe("MultiPolygon");
    for (const polygon of geometry.coordinates) {
      if (!Array.isArray(polygon) || !polygon.length) throw new Error("polygon");
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4) throw new Error("ring");
        for (const point of ring) {
          if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error("coordinate");
        }
        if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw new Error("open_ring");
      }
    }
    return geometry;
  }
  const oldMs: number[] = [], newMs: number[] = [];
  for (let i = 0; i < 5; i++) {
    let start = performance.now();
    const oldGeometry = await oldLoader();
    oldMs.push(performance.now() - start);
    start = performance.now();
    const result = await loadMunicipalSectionGeometry();
    newMs.push(performance.now() - start);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.geometry).toEqual(oldGeometry);
  }
  const oldBytes = await readFile(resolve(root, SECTION_SOURCE.archived_path));
  const newBytes = await readFile(resolve(SECTION_PATH));
  const median = (times: number[]) => [...times].sort((a, b) => a - b)[2];
  console.log(JSON.stringify({ node: process.version, method: "five alternating sequential invocations in one Vitest process; filesystem cache uncontrolled; no GC forcing; old algorithm includes assertions; no RSS estimate or hosted request", oldMs, newMs, oldMedianMs: median(oldMs), newMedianMs: median(newMs), oldRawBytes: oldBytes.length, oldGzipBytes: gzipSync(oldBytes).length, newRawBytes: newBytes.length, newGzipBytes: gzipSync(newBytes).length }));
}, 30_000);
