import { describe, expect, it } from "vitest";
import {
  partyFamilyRefusal,
  pinnedCategoryId,
  resolvePartyFamily,
  servedJurisdictionId,
} from "./party-family";

describe("resolvePartyFamily", () => {
  it("test_each_configured_jurisdiction_resolves_to_its_own_family", () => {
    const env = { NATIONAL_JURISDICTION_ID: "j-nat", MUNICIPAL_JURISDICTION_ID: "j-mun" };
    expect(resolvePartyFamily("j-nat", env)).toEqual({ status: "ok", family: "national" });
    expect(resolvePartyFamily("j-mun", env)).toEqual({
      status: "ok",
      family: "coronel_rosales_municipal",
    });
  });

  it("test_one_id_claiming_both_families_is_a_collision_not_a_pick", () => {
    // An object literal let the later key win silently.
    expect(
      resolvePartyFamily("j-both", {
        NATIONAL_JURISDICTION_ID: "j-both",
        MUNICIPAL_JURISDICTION_ID: "j-both",
      }),
    ).toEqual({ status: "collision", jurisdictionId: "j-both" });
  });

  it("test_an_unconfigured_scope_is_not_a_missing_jurisdiction", () => {
    // Two different problems, two different answers: nothing is pinned versus
    // this id is pinned to nothing.
    expect(resolvePartyFamily("j-nat", {})).toEqual({ status: "unconfigured" });
    expect(
      resolvePartyFamily("j-other", { NATIONAL_JURISDICTION_ID: "j-nat" }),
    ).toEqual({ status: "unknown_jurisdiction", jurisdictionId: "j-other" });
  });
});

describe("pinnedCategoryId", () => {
  it("test_a_route_category_is_read_in_one_place", () => {
    expect(pinnedCategoryId("MUNICIPAL", { MUNICIPAL_CATEGORY_ID: "c-con" })).toBe("c-con");
  });

  it("test_an_unset_category_is_absent_rather_than_an_empty_string", () => {
    // An empty string is a value; absence is not. Callers refuse on absence.
    expect(pinnedCategoryId("FISCALIZACION", {})).toBeUndefined();
    expect(pinnedCategoryId("FISCALIZACION", { FISCALIZACION_CATEGORY_ID: "" })).toBeUndefined();
  });
});

describe("servedJurisdictionId", () => {
  it("test_the_served_id_is_the_configured_one", () => {
    expect(
      servedJurisdictionId("national", {
        NATIONAL_JURISDICTION_ID: "j-nat",
        MUNICIPAL_JURISDICTION_ID: "j-mun",
      }),
    ).toEqual({ status: "ok", jurisdictionId: "j-nat" });
  });

  it("test_a_collision_refuses_here_exactly_as_it_refuses_for_the_family", () => {
    // The route that read the env directly served while the other three
    // refused; one boundary means one answer.
    expect(
      servedJurisdictionId("national", {
        NATIONAL_JURISDICTION_ID: "j-same",
        MUNICIPAL_JURISDICTION_ID: "j-same",
      }),
    ).toEqual({ status: "collision", jurisdictionId: "j-same" });
  });

  it("test_an_unconfigured_family_yields_no_id", () => {
    expect(servedJurisdictionId("coronel_rosales_municipal", { NATIONAL_JURISDICTION_ID: "j-nat" })).toEqual({
      status: "unconfigured",
    });
  });
});

describe("partyFamilyRefusal", () => {
  it("test_a_matching_family_is_not_a_refusal", () => {
    expect(partyFamilyRefusal({ status: "ok", family: "national" }, "national")).toBeNull();
  });

  it("test_a_resolved_but_wrong_family_refuses_for_this_caller", () => {
    // `ok` is not `ok for you`: a national jurisdiction resolved through the
    // municipal table names `2206` as a different party.
    expect(
      partyFamilyRefusal({ status: "ok", family: "national" }, "coronel_rosales_municipal"),
    ).toBe("jurisdiction is mapped by the national party table, not coronel_rosales_municipal");
  });

  it("test_an_unrecognized_expected_family_refuses_rather_than_matching", () => {
    // Two callers take this from the query string, so it can be anything.
    expect(partyFamilyRefusal({ status: "ok", family: "national" }, "banana")).toContain(
      "not banana",
    );
  });

  it("test_every_refusal_names_its_own_cause", () => {
    expect(partyFamilyRefusal({ status: "unconfigured" }, "national")).toContain(
      "are not configured",
    );
    expect(
      partyFamilyRefusal({ status: "collision", jurisdictionId: "j-same" }, "national"),
    ).toContain("j-same is configured as both");
    // The ID travels: municipal's variant dropped it, so the operator was told
    // a jurisdiction was unmapped without being told WHICH.
    expect(
      partyFamilyRefusal({ status: "unknown_jurisdiction", jurisdictionId: "j-999" }, "national"),
    ).toContain("j-999");
  });
});
