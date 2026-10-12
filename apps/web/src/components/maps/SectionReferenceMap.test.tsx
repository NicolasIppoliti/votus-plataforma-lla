import { describe, expect, it } from "vitest";
import { shareFill } from "./SectionReferenceMap";
import { REFERENCE_FILL, REFERENCE_LINE } from "./reference-colors";

describe("fixed electoral fill domain", () => {
  it("interpolates the same endpoints and midpoint independently of the election", () => {
    expect(shareFill(0)).toEqual([21, 50, 66, 220]);
    expect(shareFill(50)).toEqual([61, 140, 154, 220]);
    expect(shareFill(100)).toEqual([101, 229, 242, 220]);
    expect(shareFill(50)).toEqual(shareFill(50));
  });

  it("brightens toward cyan as share grows, so high shares stay visible on the navy map stage", () => {
    const luminance = ([r, g, b]: readonly number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    expect(luminance(shareFill(100))).toBeGreaterThan(luminance(shareFill(50)));
    expect(luminance(shareFill(50))).toBeGreaterThan(luminance(shareFill(0)));
  });
});

describe("reference geography colors", () => {
  it("paints unfilled reference geography in the approved cyan", () => {
    expect(REFERENCE_FILL).toEqual([101, 229, 242, 40]);
    expect(REFERENCE_LINE).toEqual([101, 229, 242, 200]);
  });
});
