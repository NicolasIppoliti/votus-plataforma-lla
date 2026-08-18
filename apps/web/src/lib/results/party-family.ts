/**
 * Which curated party-mapping family describes a trusted race context.
 *
 * ONE boundary. This decision was copy-pasted into `compare` and `drilldown`
 * with a third variant in `municipal`, so a fix to the context rule in one
 * left the others on the old behaviour — the shape rule 8 records as "the same
 * padding bug in two independent functions".
 *
 * The physical id is CONFIGURATION and the family is trusted route context:
 * taking both the jurisdiction and the family from the query string let a national jurisdiction
 * be resolved through the municipal table, where list `2206` names a different
 * party.
 */
export const PARTY_FAMILY = {
  NATIONAL: "national",
  MUNICIPAL: "coronel_rosales_municipal",
} as const;
export type PartyFamily = (typeof PARTY_FAMILY)[keyof typeof PARTY_FAMILY];

export type PartyFamilyResolution =
  | { status: "ok"; family: PartyFamily }
  | { status: "unconfigured" }
  | { status: "unknown_jurisdiction"; jurisdictionId: string };

export function resolvePartyFamily(
  jurisdictionId: string | undefined,
  family: PartyFamily,
  env: Record<string, string | undefined> = process.env,
): PartyFamilyResolution {
  const configured = env["CORONEL_ROSALES_JURISDICTION_ID"];

  if (!configured) return { status: "unconfigured" };
  if (jurisdictionId !== configured) {
    return { status: "unknown_jurisdiction", jurisdictionId: jurisdictionId ?? "(none)" };
  }
  return { status: "ok", family };
}


/**
 * Why a family resolution refuses, in ONE wording.
 *
 * The resolution moved behind this boundary and its REFUSAL COPY did not:
 * `compare` and `drilldown` carried a verbatim duplicate of the same
 * branching refusal while `municipal` carried a third variant that dropped
 * the `unknown_jurisdiction` id and reordered the branches. One decision,
 * three renderings — a fix to one wording leaves the others on the old text.
 *
 * `expectedFamily` is the family the calling route serves; naming it is what
 * makes an `ok`-but-wrong-family resolution a refusal for that caller.
 */
export function partyFamilyRefusal(
  resolution: PartyFamilyResolution,
  // A plain string: legacy callers can supply anything, so a cast to
  // `PartyFamily` here would assert something the request never proved.
  expectedFamily: string,
): string | null {
  switch (resolution.status) {
    case "unconfigured":
      return "CORONEL_ROSALES_JURISDICTION_ID no está configurado";
    case "unknown_jurisdiction":
      return `la jurisdicción ${resolution.jurisdictionId} no es la jurisdicción física configurada`;
    case "ok":
      return resolution.family === expectedFamily
        ? null
        : `la tabla de partidos ${resolution.family} mapea la carrera, no ${expectedFamily}`;
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
 * The one configured physical jurisdiction. The family argument is trusted race
 * context and never changes which physical id is returned.
 */
export type ServedJurisdiction =
  | { status: "ok"; jurisdictionId: string }
  | { status: "unconfigured" };

export function servedJurisdictionId(
  family: PartyFamily,
  env: Record<string, string | undefined> = process.env,
): ServedJurisdiction {
  const configured = env["CORONEL_ROSALES_JURISDICTION_ID"];
  if (!configured) return { status: "unconfigured" };
  const resolution = resolvePartyFamily(configured, family, env);
  if (resolution.status !== "ok" || resolution.family !== family) {
    return { status: "unconfigured" };
  }
  return { status: "ok", jurisdictionId: configured };
}
