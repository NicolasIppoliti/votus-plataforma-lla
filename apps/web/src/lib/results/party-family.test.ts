import { describe, expect, it } from "vitest";
import {
  PARTY_FAMILY,
  partyFamilyRefusal,
  pinnedCategoryId,
  resolvePartyFamily,
  servedJurisdictionId,
} from "./party-family";

describe("resolvePartyFamily", () => {
  it("test_each_trusted_race_context_uses_the_same_physical_jurisdiction", () => {
    const env = { CORONEL_ROSALES_JURISDICTION_ID: "j-027" };
    expect(resolvePartyFamily("j-027", PARTY_FAMILY.NATIONAL, env)).toEqual({ status: "ok", family: "national" });
    expect(resolvePartyFamily("j-027", PARTY_FAMILY.MUNICIPAL, env)).toEqual({
      status: "ok",
      family: "coronel_rosales_municipal",
    });
  });

  it("test_one_physical_id_is_not_a_party_family_collision", () => {
    const env = { CORONEL_ROSALES_JURISDICTION_ID: "j-both" };
    expect(resolvePartyFamily("j-both", PARTY_FAMILY.NATIONAL, env)).toEqual({
      status: "ok", family: "national",
    });
    expect(resolvePartyFamily("j-both", PARTY_FAMILY.MUNICIPAL, env)).toEqual({
      status: "ok", family: "coronel_rosales_municipal",
    });
  });

  it("test_an_unconfigured_scope_is_not_a_missing_jurisdiction", () => {
    expect(resolvePartyFamily("j-027", PARTY_FAMILY.NATIONAL, {})).toEqual({ status: "unconfigured" });
    expect(
      resolvePartyFamily("j-other", PARTY_FAMILY.NATIONAL, { CORONEL_ROSALES_JURISDICTION_ID: "j-027" }),
    ).toEqual({ status: "unknown_jurisdiction", jurisdictionId: "j-other" });
  });
});

describe("pinnedCategoryId", () => {
  it("test_a_route_category_is_read_in_one_place", () => {
    expect(pinnedCategoryId("MUNICIPAL", { MUNICIPAL_CATEGORY_ID: "c-con" })).toBe("c-con");
  });

  it("test_an_unset_category_is_absent_rather_than_an_empty_string", () => {
    expect(pinnedCategoryId("FISCALIZACION", {})).toBeUndefined();
    expect(pinnedCategoryId("FISCALIZACION", { FISCALIZACION_CATEGORY_ID: "" })).toBeUndefined();
  });
});

describe("servedJurisdictionId", () => {
  it("test_the_served_id_is_the_configured_physical_one", () => {
    expect(
      servedJurisdictionId(PARTY_FAMILY.NATIONAL, {
        CORONEL_ROSALES_JURISDICTION_ID: "j-027",
      }),
    ).toEqual({ status: "ok", jurisdictionId: "j-027" });
  });

  it("test_legacy_duplicate_ids_are_not_a_fallback", () => {
    expect(
      servedJurisdictionId(PARTY_FAMILY.NATIONAL, {
        NATIONAL_JURISDICTION_ID: "j-same",
        MUNICIPAL_JURISDICTION_ID: "j-same",
      }),
    ).toEqual({ status: "unconfigured" });
  });

  it("test_an_unconfigured_family_yields_no_id", () => {
    expect(servedJurisdictionId(PARTY_FAMILY.MUNICIPAL, {})).toEqual({
      status: "unconfigured",
    });
  });
});

describe("partyFamilyRefusal", () => {
  it("test_a_matching_family_is_not_a_refusal", () => {
    expect(partyFamilyRefusal({ status: "ok", family: "national" }, "national")).toBeNull();
  });

  it("test_a_resolved_but_wrong_family_refuses_for_this_caller", () => {
    expect(
      partyFamilyRefusal({ status: "ok", family: "national" }, "coronel_rosales_municipal"),
    ).toContain("no coronel_rosales_municipal");
  });

  it("test_an_unrecognized_expected_family_refuses_rather_than_matching", () => {
    expect(partyFamilyRefusal({ status: "ok", family: "national" }, "banana")).toContain(
      "no banana",
    );
  });

  it("test_every_refusal_names_its_own_cause", () => {
    expect(partyFamilyRefusal({ status: "unconfigured" }, "national")).toContain(
      "CORONEL_ROSALES_JURISDICTION_ID",
    );
    expect(
      partyFamilyRefusal({ status: "unknown_jurisdiction", jurisdictionId: "j-999" }, "national"),
    ).toContain("j-999");
  });
});
