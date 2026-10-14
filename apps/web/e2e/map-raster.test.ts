import { describe, expect, it } from "vitest";
import { alignedOccupiedGeometry } from "./map-raster";

const raster = (width: number, height: number, occupied: number[], color: number[]) => {
  const rgba = Array.from({ length: width * height }, () => [255, 255, 255, 255]).flat();
  for (const index of occupied) rgba.splice(index * 4, 4, ...color, 255);
  return { width, height, rgba };
};
const left = [14, 15, 16, 24, 25, 26, 34, 35, 36];
const right = [15, 16, 17, 25, 26, 27, 35, 36, 37];
const a = [103, 141, 165], b = [71, 117, 144];

describe("rendered polygon alignment", () => {
  it("accepts differently colored polygons shifted by one raster pixel", () => {
    expect(alignedOccupiedGeometry(raster(10, 10, left, a), a, raster(10, 10, right, b), b, 3)).toBe(true);
  });
  it("rejects an empty mask and mismatched dimensions", () => {
    expect(alignedOccupiedGeometry(raster(10, 10, left, a), a, raster(10, 10, [], b), b, 3)).toBe(false);
    expect(alignedOccupiedGeometry(raster(10, 10, left, a), a, raster(11, 10, left, b), b, 3)).toBe(false);
  });
  it("does not treat identically rendered edge pixels as misaligned geometry", () => {
    // An antialiased outline pixel rendered identically in both views may fall inside only one
    // side's fill tolerance; identical rendering is not evidence of a geometric offset.
    const edge = [70, 80, 90], tone = b.map((channel) => channel + 2);
    const withEdge = (base: ReturnType<typeof raster>) => {
      for (const index of edge) base.rgba.splice(index * 4, 4, ...tone, 255);
      return base;
    };
    expect(alignedOccupiedGeometry(withEdge(raster(10, 10, left, a)), a, withEdge(raster(10, 10, left, b)), b, 3)).toBe(true);
    // The same tone present only in the second view is real second-view content and still fails.
    expect(alignedOccupiedGeometry(raster(10, 10, left, a), a, withEdge(raster(10, 10, left, b)), b, 3)).toBe(false);
  });
  it("rejects a two-pixel shift and row-wrap adjacency", () => {
    expect(alignedOccupiedGeometry(raster(10, 10, left, a), a, raster(10, 10, left.map((i) => i + 2), b), b, 3)).toBe(false);
    expect(alignedOccupiedGeometry(raster(10, 10, [19], a), a, raster(10, 10, [20], b), b, 1)).toBe(false);
  });
});
