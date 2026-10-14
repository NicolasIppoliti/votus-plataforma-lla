import { expect, it } from "vitest";
import { formatCount, formatDecimal, formatExactNumber, formatFixed2 } from "./number";

it("formats every displayed number with es-AR grouping and decimals (#451)", () => {
  expect(formatCount(14550)).toBe("14.550");
  expect(formatCount(0)).toBe("0");
  expect(formatFixed2(12.5)).toBe("12,50");
  expect(formatDecimal(12.5)).toBe("12,5");
  expect(formatDecimal(1234.567)).toBe("1.234,57");
  expect(formatExactNumber(28196825)).toBe("28.196.825");
  expect(formatExactNumber(1234.0625)).toBe("1234,0625");
});
