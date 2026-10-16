import { expect, it } from "vitest";
import { sourceKindLabel } from "./source-kind-label";

it("names every source kind in Spanish and never echoes an unknown machine value (#612)", () => {
  expect(sourceKindLabel("official")).toBe("oficial");
  expect(sourceKindLabel("fiscalizacion")).toBe("fiscalización");
  expect(sourceKindLabel("unknown")).toBe("desconocida");
  expect(sourceKindLabel("future_kind")).toBe("Sin clasificar");
});
