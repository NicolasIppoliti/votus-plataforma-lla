import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { scenarioVotes } from "./scenario-simulation";

describe("scenarioVotes", () => {
  it("recovers exact persistence votes and refuses fractional persistence", () => {
    expect(scenarioVotes(["14550/32291", "17741/32291"], true).votes).toEqual([14550, 17741]);
    expect(() => scenarioVotes(["1/2", "1/2"], true)).toThrow();
  });
  it("breaks equal remainders by larger share then artifact order", () => {
    expect(scenarioVotes(["1/6", "5/6"], false).votes).toEqual([5382, 26909]);
    expect(scenarioVotes(["1/2", "1/2"], false).votes).toEqual([16146, 16145]);
  });
  it("rejects shares that do not sum to one", () => {
    expect(() => scenarioVotes(["1/3"], false)).toThrow();
  });
});
