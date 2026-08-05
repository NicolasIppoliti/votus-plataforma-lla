/**
 * Which curated party-mapping family describes a jurisdiction.
 *
 * ONE boundary. This decision was copy-pasted into `compare` and `drilldown`
 * with a third variant in `municipal`, so a fix to the collision rule in one
 * left the others on the old behaviour — the shape rule 8 records as "the same
 * padding bug in two independent functions".
 *
 * The pairing is CONFIGURATION, not a request parameter: taking both the
 * jurisdiction and the family from the query string let a national jurisdiction
 * be resolved through the municipal table, where list `2206` names a different
 * party.
 */
export type PartyFamily = "national" | "coronel_rosales_municipal";

export type PartyFamilyResolution =
  | { status: "ok"; family: PartyFamily }
  | { status: "unconfigured" }
  | { status: "collision"; jurisdictionId: string }
  | { status: "unknown_jurisdiction"; jurisdictionId: string };

export function resolvePartyFamily(
  jurisdictionId: string | undefined,
  env: Record<string, string | undefined> = process.env,
): PartyFamilyResolution {
  const nationalId = env["NATIONAL_JURISDICTION_ID"];
  const municipalId = env["MUNICIPAL_JURISDICTION_ID"];

  if (!nationalId && !municipalId) return { status: "unconfigured" };
  // A COLLISION is a misconfiguration, not a tie to break. An object literal
  // let the later key win silently and pick one family for a jurisdiction that
  // claims both.
  if (nationalId && nationalId === municipalId) {
    return { status: "collision", jurisdictionId: nationalId };
  }
  if (jurisdictionId && jurisdictionId === nationalId) {
    return { status: "ok", family: "national" };
  }
  if (jurisdictionId && jurisdictionId === municipalId) {
    return { status: "ok", family: "coronel_rosales_municipal" };
  }
  return { status: "unknown_jurisdiction", jurisdictionId: jurisdictionId ?? "(none)" };
}


/**
 * Why a family resolution refuses, in ONE wording.
 *
 * The resolution moved behind this boundary and its REFUSAL COPY did not:
 * `compare` and `drilldown` carried a verbatim duplicate of the same
 * four-branch ternary while `municipal` carried a third variant that dropped
 * the `unknown_jurisdiction` id and reordered the branches. One decision,
 * three renderings — a fix to one wording leaves the others on the old text.
 *
 * `expectedFamily` is the family the calling route serves; naming it is what
 * makes an `ok`-but-wrong-family resolution a refusal for that caller.
 */
export function partyFamilyRefusal(
  resolution: PartyFamilyResolution,
  // A plain string: two of the three callers take this from the query string,
  // so a cast to `PartyFamily` here would assert something the request never
  // proved. An unrecognized value simply never equals the resolved family and
  // refuses, which is the right answer.
  expectedFamily: string,
): string | null {
  switch (resolution.status) {
    case "unconfigured":
      return "NATIONAL_JURISDICTION_ID and MUNICIPAL_JURISDICTION_ID are not configured";
    case "collision":
      return (
        `${resolution.jurisdictionId} is configured as both the national and ` +
        "the municipal jurisdiction"
      );
    case "unknown_jurisdiction":
      return `jurisdiction ${resolution.jurisdictionId} is mapped by no configured party table`;
    case "ok":
      return resolution.family === expectedFamily
        ? null
        : `jurisdiction is mapped by the ${resolution.family} party table, not ${expectedFamily}`;
  }
}

/**
 * The pinned CATEGORY a route serves, read in ONE place.
 *
 * `municipal` read `MUNICIPAL_CATEGORY_ID` straight from the env at the call
 * site while its jurisdiction went through `resolvePartyFamily`, and
 * `fiscalizacion` had its own `fiscalizacionScope()` doing the same job —
 * three readers of one kind of fact, and the municipal refusal copy had
 * already drifted to name two variables while checking one.
 *
 * Category ONLY. A `<PREFIX>_JURISDICTION_ID` key was also offered here, and
 * no route read it: jurisdiction identity belongs to `resolvePartyFamily` and
 * `servedJurisdictionId` below, so a second per-route jurisdiction var was an
 * id that could disagree with the one the party mapping was resolved through.
 */
export function pinnedCategoryId(
  prefix: "MUNICIPAL" | "FISCALIZACION",
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env[`${prefix}_CATEGORY_ID`] || undefined;
}

/**
 * The configured id of a family's jurisdiction, subject to the SAME collision
 * rule the family resolution applies.
 *
 * `fiscalizacion` read `NATIONAL_JURISDICTION_ID` from the env directly, so
 * with both ids configured the same the three routes that ask
 * `resolvePartyFamily` refused the collision while this one served — a
 * fourth reader of the one fact this module was extracted to own.
 */
export type ServedJurisdiction =
  | { status: "ok"; jurisdictionId: string }
  | { status: "unconfigured" }
  | { status: "collision"; jurisdictionId: string };

export function servedJurisdictionId(
  family: PartyFamily,
  env: Record<string, string | undefined> = process.env,
): ServedJurisdiction {
  const key =
    family === "national" ? "NATIONAL_JURISDICTION_ID" : "MUNICIPAL_JURISDICTION_ID";
  const configured = env[key];
  if (!configured) return { status: "unconfigured" };
  // Asked through the one boundary rather than re-implemented: a `collision`
  // here is the same collision the other routes refuse.
  const resolution = resolvePartyFamily(configured, env);
  if (resolution.status === "collision") return resolution;
  if (resolution.status !== "ok" || resolution.family !== family) {
    return { status: "unconfigured" };
  }
  return { status: "ok", jurisdictionId: configured };
}
