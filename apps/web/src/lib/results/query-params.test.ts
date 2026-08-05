import { describe, expect, it } from "vitest";
import { repeatedParams, stringParam } from "./query-params";

describe("query params", () => {
  it("test_a_repeated_param_is_not_reported_as_absent", () => {
    // The defect this module exists for: a SUPPLIED value collapsing to
    // `undefined`, so the page claims the request omitted it.
    // Driven through the PUBLIC surface, which is what routes call: a repeat
    // and an omission both make `stringParam` answer `undefined`, and only
    // `repeatedParams` tells them apart. Testing the internal reader made that
    // distinction look covered where routes cannot reach it.
    expect(repeatedParams({ electionId: ["a", "b"] })).toEqual(["electionId"]);
    expect(repeatedParams({})).toEqual([]);
    expect(stringParam({ electionId: ["a", "b"] }, "electionId")).toBeUndefined();
    expect(stringParam({}, "electionId")).toBeUndefined();
  });

  it("test_repeated_params_are_named", () => {
    expect(repeatedParams({ a: ["1", "2"], b: "1", c: ["3"] })).toEqual(["a", "c"]);
  });

  it("test_the_plain_accessor_still_yields_undefined_for_a_repeat", () => {
    // Stated, not hidden: that is exactly why a route must refuse repeats
    // before it reads anything.
    expect(stringParam({ a: ["1", "2"] }, "a")).toBeUndefined();
    expect(stringParam({ a: "1" }, "a")).toBe("1");
  });
});
