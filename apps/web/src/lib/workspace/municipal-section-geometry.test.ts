import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  return { ...actual, createHash: vi.fn(actual.createHash) };
});
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
import { loadMunicipalSectionGeometry } from "./municipal-section-geometry";

const HASH = "964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673";
const PATH = "archive/geography/cne-pba-sections." + HASH + ".geojson";
const point = [-62, -38];
const validFeature = () => ({ type: "Feature", properties: { provincia: "Buenos Aires", departamen: "Cnel. de Marina L.Rosales", cabecera: "Punta Alta" }, geometry: { type: "MultiPolygon", coordinates: [[[[...point], [-61, -38], [-61, -37], [...point]]]] } });
const validCollection = () => ({ type: "FeatureCollection", crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::4326" } }, features: [validFeature()] });
const validRecord = () => ({ id: "geography/cne-pba-sections", archived_path: PATH, sha256: HASH, mime: "application/json", status: "ok", bytes: 30269143, fetched_at: "2026-09-24T03:29:24Z" });

async function readFixture(collection: unknown, records: unknown = [validRecord()]) {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const bytes = Buffer.from(JSON.stringify(collection));
  const padded = Buffer.concat([bytes, Buffer.alloc(30269143 - bytes.length, 32)]);
  vi.mocked(readFile).mockImplementationOnce(async () => JSON.stringify({ records }))
    .mockImplementationOnce(async () => padded);
  const crypto = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  vi.mocked(createHash).mockImplementationOnce(() => Object.assign(crypto.createHash("sha256"), { digest: () => HASH }));
  const result = await loadMunicipalSectionGeometry();
  vi.mocked(readFile).mockImplementation(actual.readFile);
  vi.mocked(createHash).mockRestore();
  return result;
}

describe("municipal section archive boundary", () => {
  it("reads the verified full archive and selects the unique CNE section", async () => {
    const section = await loadMunicipalSectionGeometry();
    expect(section.status).toBe("ok");
    if (section.status === "ok") {
      expect(section.name).toBe("Cnel. de Marina L.Rosales");
      expect(section.geometry.type).toBe("MultiPolygon");
      expect(section.sha256).toBe("964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673");
    }
  });

  it.each([
    ["wrong cabecera", { ...validCollection(), features: [{ ...validFeature(), properties: { ...validFeature().properties, cabecera: "Other" } }] }],
    ["wrong CRS", { ...validCollection(), crs: { type: "name", properties: { name: "EPSG:3857" } } }],
    ["zero matching sections", { ...validCollection(), features: [] }],
    ["two matching sections", { ...validCollection(), features: [validFeature(), validFeature()] }],
    ["invalid coordinate", { ...validCollection(), features: [{ ...validFeature(), geometry: { type: "MultiPolygon", coordinates: [[[[200, -38], [-61, -38], [-61, -37], [200, -38]]]] } }] }],
    ["open ring", { ...validCollection(), features: [{ ...validFeature(), geometry: { type: "MultiPolygon", coordinates: [[[[...point], [-61, -38], [-61, -37], [-62, -37]]]] } }] }],
  ])("withholds %s after archive validation", async (_reason, collection) => {
    expect(await readFixture(collection)).toEqual({ status: "withheld" });
  });

  it.each([
    ["missing manifest entry", []],
    ["stale manifest date", [{ ...validRecord(), fetched_at: "2020-01-01T00:00:00Z" }]],
  ])("withholds %s", async (_reason, records) => {
    expect(await readFixture(validCollection(), records)).toEqual({ status: "withheld" });
  });

  it("withholds geometry when full archived bytes fail digest verification", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(readFile).mockImplementationOnce(actual.readFile).mockImplementationOnce(async () => Buffer.from("{}"));
    expect(await loadMunicipalSectionGeometry()).toEqual({ status: "withheld" });
    vi.mocked(readFile).mockRestore();
  });
});
