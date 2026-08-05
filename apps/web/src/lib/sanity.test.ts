import { describe, expect, it } from "vitest";

// Scaffolding smoke test. Proves the vitest runner is wired correctly
// before any production web code exists. Intentionally trivial: Phase 1
// only establishes the test runner, per tasks.md task 1.2.
describe("vitest runner scaffold", () => {
  it("is wired and can execute a real assertion", () => {
    const sum = (a: number, b: number): number => a + b;
    expect(sum(2, 2)).toBe(4);
  });
});
