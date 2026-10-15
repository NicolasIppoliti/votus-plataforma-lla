import { afterEach, describe, expect, it, vi } from "vitest";
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
import { loadMunicipalSectionGeometry, SECTION_PATH, SECTION_SHA256 } from "./municipal-section-geometry";
import { resolve } from "node:path";

afterEach(() => vi.mocked(readFile).mockClear());
describe("municipal section derivative boundary", () => {
  it("reads only the small pinned derivative, never the archive or manifest", async () => {
    const section = await loadMunicipalSectionGeometry();
    expect(section.status).toBe("ok");
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(readFile).mock.calls[0]![0])).toMatch(/data\/geography\/cne-rosales-section\.[a-f0-9]{64}\.json$/);
    if (section.status === "ok") {
      expect(section.name).toBe("Cnel. de Marina L.Rosales");
      expect(section.geometry.type).toBe("MultiPolygon");
      expect(section.sha256).toBe("964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673");
    }
  });
  it.each(["identity", "source", "reference_only", "historical_applicability", "open_ring", "invalid_coordinate", "empty_components", "wrong_crs"])("fails closed on structurally invalid derivative: %s", async (reason) => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const artifact = JSON.parse(await actual.readFile(resolve(SECTION_PATH), "utf8"));
    if (reason === "identity") artifact.feature.properties.gid = 99999;
    if (reason === "source") artifact.source.sha256 = "0".repeat(64);
    if (reason === "reference_only") artifact.reference_only = false;
    if (reason === "historical_applicability") artifact.historical_applicability = "2023";
    if (reason === "wrong_crs") artifact.crs = "EPSG:3857";
    if (reason === "open_ring") artifact.feature.geometry.coordinates[0][0].pop();
    if (reason === "invalid_coordinate") artifact.feature.geometry.coordinates[0][0][1][0] = 200;
    if (reason === "empty_components") artifact.feature.geometry.coordinates = [];
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from(JSON.stringify(artifact)));
    // Isolate schema checks behind the independent digest gate. Other tests
    // exercise the actual digest; production never substitutes this hash.
    const crypto = await vi.importActual<typeof import("node:crypto")>("node:crypto");
    vi.mocked(createHash).mockImplementationOnce(() => Object.assign(crypto.createHash("sha256"), { digest: () => SECTION_SHA256 }));
    expect(await loadMunicipalSectionGeometry()).toEqual({ status: "withheld" });
  });
  it("fails closed on missing bytes", async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error("ENOENT"));
    expect(await loadMunicipalSectionGeometry()).toEqual({ status: "withheld" });
  });
  it.each(["{}", "not JSON", "{\"reference_only\":false}"])("fails closed on corrupt bytes: %s", async (bytes) => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from(bytes));
    expect(await loadMunicipalSectionGeometry()).toEqual({ status: "withheld" });
  });
});
