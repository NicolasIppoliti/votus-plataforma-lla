import { describe, expect, it } from "vitest";
import { normalizeExplorationParams } from "../results/exploration";
import { parseElectoralContext, serializeElectoralContext } from "./url";

describe("electoral context URL contract", () => {
  it("rejects a PBA partido in the existing national normalization boundary", () => {
    expect(normalizeExplorationParams({ distritoCode: "027" }).status).toBe("invalid");
  });
  it("round-trips partial context with official default", () => {
    const parsed = parseElectoralContext({});
    expect(parsed).toEqual({ status: "ok", value: { sourceKind: "official" } });
    if (parsed.status === "ok") expect(parseElectoralContext(serializeElectoralContext(parsed.value))).toEqual(parsed);
  });
  it("normalizes national lineage and round-trips both sides", () => {
    const parsed = parseElectoralContext({ electionId: "election-a", categoryId: "category-a", bElectionId: "election-b", bCategoryId: "category-b", distritoCode: "2", seccionCode: "27", circuitoCode: "12a", establecimientoCode: "school", mesaCode: "003", sourceKind: "fiscalizacion" });
    expect(parsed.status).toBe("ok");
    if (parsed.status === "ok") {
      expect(parsed.value).toMatchObject({ distritoCode: "02", seccionCode: "027", circuitoCode: "0012A", mesaCode: 3, sourceKind: "fiscalizacion" });
      expect(parseElectoralContext(serializeElectoralContext(parsed.value))).toEqual(parsed);
    }
  });
  it.each([{ distritoCode: "027" }, { distritoCode: "abc" }, { seccionCode: "x" }, { mesaCode: "9007199254740992" }, { sourceKind: "internal" }, { electionId: ["a", "b"] }])("rejects invalid context %j", (raw) => {
    expect(parseElectoralContext(raw).status).toBe("invalid");
  });
  it("rejects repeated URLSearchParams rather than picking the first", () => {
    expect(parseElectoralContext(new URLSearchParams("electionId=a&electionId=b")).status).toBe("invalid");
  });
  it("validates serialization through the same national boundary", () => {
    expect(() => serializeElectoralContext({ sourceKind: "official", distritoCode: "027" })).toThrow();
  });
  it("ignores route-local keys without making them shared context", () => {
    expect(parseElectoralContext({ year: "2025", metric: "votes" })).toEqual({ status: "ok", value: { sourceKind: "official" } });
  });
  it("treats empty optional values as missing, without selecting a default election", () => {
    expect(parseElectoralContext({ electionId: " ", distritoCode: "", sourceKind: "" })).toEqual({ status: "ok", value: { sourceKind: "official" } });
  });
});
