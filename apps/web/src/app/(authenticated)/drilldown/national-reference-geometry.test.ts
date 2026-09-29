import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadNationalReference, NATIONAL_REFERENCE_PATH, polarReferencePath } from "./national-reference-geometry";

const assetPath = resolve(process.cwd(), "public", NATIONAL_REFERENCE_PATH.slice(1));

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("crypto", webcrypto);
});

describe("public national geometry consumer", () => {
  it("accepts the immutable public asset and projects its complete components without mutating parsed geometry", async () => {
    const bytes = await readFile(assetPath);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes)));
    const feature = await loadNationalReference();
    expect(feature.geometry.coordinates).toHaveLength(1980);
    expect(feature.geometry.coordinates.reduce((sum, polygon) => sum + polygon.length, 0)).toBe(1991);
    const originalCoordinates = structuredClone(feature.geometry.coordinates);
    const adaptedExterior = feature.geometry.coordinates.find((polygon) => {
      const ring = polygon[0]!;
      return ring.slice(1).reduce((area, point, index) => area + ring[index]![0]! * point[1]! - point[0]! * ring[index]![1]!, 0) > 0;
    })?.[0];
    expect(adaptedExterior).toBeDefined();
    const originalExterior = structuredClone(adaptedExterior);
    const path = await polarReferencePath(feature);
    expect(path).toMatch(/^M/);
    expect(path).not.toMatch(/NaN|Infinity/);
    expect(path.match(/M/g)?.length).toBeGreaterThanOrEqual(1980);
    expect(feature.geometry.coordinates).toEqual(originalCoordinates);
    expect(adaptedExterior).toEqual(originalExterior);
  });

  it("rejects a response with altered integrity instead of drawing partial geography", async () => {
    const bytes = await readFile(assetPath);
    bytes[bytes.length - 2] = bytes[bytes.length - 2] === 32 ? 10 : 32;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes)));
    await expect(loadNationalReference()).rejects.toThrow("checksum mismatch");
  });
});
