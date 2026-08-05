import { describe, expect, it } from "vitest";
import { electionYear } from "./election-id";

describe("electionYear", () => {
  it("test_every_registered_election_id_resolves", () => {
    for (const [id, year] of [
      ["2023-paso", 2023],
      ["2023-generales", 2023],
      ["2023-balotaje", 2023],
      ["2023-municipal", 2023],
      ["2025-legislativas-nacional", 2025],
      ["2025-municipal", 2025],
    ] as const) {
      expect(electionYear(id)).toBe(year);
    }
  });

  it("test_an_id_with_two_years_is_refused_not_resolved_to_the_first", () => {
    // Taking the first `\d{4}` anywhere in the string silently picks one.
    expect(electionYear("2023-2025-comparativa")).toBeNull();
  });

  it("test_an_id_with_no_leading_year_is_refused", () => {
    expect(electionYear("legislativas-2025")).toBeNull();
    expect(electionYear("municipal")).toBeNull();
    expect(electionYear(undefined)).toBeNull();
  });
});
