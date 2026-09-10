import { expect, test } from "vitest";

import { durationInMilliseconds } from "./css-duration";

test("converts scientific-notation CSS seconds to milliseconds", () => {
  expect(durationInMilliseconds("1e-05s")).toBe(0.01);
});

test.each([
  [" 1.5s ", 1_500],
  ["0.01ms", 0.01],
  ["1E+2ms", 100],
])("converts valid CSS duration %s to %d milliseconds", (value, expected) => {
  expect(durationInMilliseconds(value)).toBe(expected);
});

test("rejects CSS duration text with trailing garbage", () => {
  expect(() => durationInMilliseconds("1e-05seconds")).toThrow(
    "unsupported CSS duration: 1e-05seconds",
  );
});
