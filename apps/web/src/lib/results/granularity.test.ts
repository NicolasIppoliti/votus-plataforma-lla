import { describe, expect, it } from "vitest";
import { GRANULARITY_ORDER, readGranularity } from "./granularity";
import { GRANULARITY } from "./types";

describe("readGranularity", () => {
  it("test_the_order_covers_every_shared_level", () => {
    // Hand-written over the const: a level added there and missing here would
    // make every row carrying it report as `distrito`.
    expect([...GRANULARITY_ORDER].sort()).toEqual(Object.values(GRANULARITY).sort());
  });

  it("test_mixed_rows_report_the_coarsest_level_and_say_they_are_mixed", () => {
    const reading = readGranularity([
      { granularity: "mesa" },
      { granularity: "seccion" },
      { granularity: "circuito" },
    ]);

    expect(reading.granularity).toBe("seccion");
    expect(reading.mixed).toEqual(["circuito", "mesa", "seccion"]);
  });

  it("test_an_unknown_level_degrades_to_the_coarsest_not_the_finest", () => {
    // The branch that decides whether bad data reads as `distrito` or as
    // `mesa`. It was documented and never checked.
    const reading = readGranularity([
      { granularity: "subcircuito" as never },
      { granularity: "mesa" },
    ]);

    expect(reading.granularity).toBe("distrito");
    expect(reading.mixed).toContain("subcircuito");
  });

  it("test_a_uniformly_unknown_level_still_degrades", () => {
    // Size-1 is not safety: an unknown level cannot be ordered, so nothing
    // finer can be claimed about it.
    const reading = readGranularity([{ granularity: "subcircuito" as never }]);

    expect(reading.granularity).toBe("distrito");
    // And SAYS SO. The name promises it degrades; asserting only the level
    // let the degradation go unreported, which is what every consumer keys on.
    expect(reading.unrecognized).toEqual(["subcircuito"]);
    expect(reading.mixed).toEqual([]);
  });

  it("test_no_rows_does_not_claim_the_finest_level", () => {
    expect(readGranularity([]).granularity).toBe("distrito");
  });

  it("test_a_uniform_set_is_not_reported_as_mixed", () => {
    expect(readGranularity([{ granularity: "mesa" }, { granularity: "mesa" }]).mixed).toEqual([]);
  });
});
