import { describe, expect, it } from "vitest";
import { parseBoundaryEnvelope } from "./boundary";

// RED (Phase 1): proves Zod 4 is wired for boundary validation before any
// domain schema exists. Production schemas are added starting in Phase 10
// (seat-allocation boundary) and Phase 11 (results-repository boundary).
describe("parseBoundaryEnvelope (Zod 4 wiring smoke test)", () => {
  it("accepts a value matching the trivial envelope shape", () => {
    const result = parseBoundaryEnvelope({ source: "scaffold" });

    expect(result.success).toBe(true);
    expect(result.success && result.data.source).toBe("scaffold");
  });

  it("rejects a value missing the required field", () => {
    const result = parseBoundaryEnvelope({});

    expect(result.success).toBe(false);
  });
});
