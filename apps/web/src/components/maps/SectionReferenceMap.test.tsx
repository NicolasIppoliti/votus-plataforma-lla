import { describe, expect, it } from "vitest";
import { shareFill } from "./SectionReferenceMap";

describe("fixed electoral fill domain", () => {
  it("interpolates the same endpoints and midpoint independently of the election", () => {
    expect(shareFill(0)).toEqual([230, 241, 247, 220]);
    expect(shareFill(50)).toEqual([124, 158, 179, 220]);
    expect(shareFill(100)).toEqual([18, 75, 110, 220]);
    expect(shareFill(50)).toEqual(shareFill(50));
  });
});
